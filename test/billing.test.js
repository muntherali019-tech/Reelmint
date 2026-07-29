import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The webhook is the only thing standing between a forged HTTP request and free
// credits / a free plan upgrade, and it runs before any auth middleware. These
// tests drive it directly against an isolated JSON store — no Stripe account,
// no network, no keys.

const SECRET = "whsec_test_secret";
let dataDir, billing, store, auth;

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "reelmint-billing-"));
  process.env.DATA_DIR = dataDir;
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  // Imported after the env is set — both modules read it at load time.
  store = await import("../server/store.js");
  auth = await import("../server/auth.js");
  billing = await import("../server/billing.js");
  await store.initStore();
});

after(() => {
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

// Build a Stripe-style signature header for a payload, exactly as Stripe does.
const sign = (payload, { secret = SECRET, at = Date.now() } = {}) => {
  const t = Math.floor(at / 1000);
  const v1 = crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${v1}`;
};

const newUser = async (email) => (await auth.signup(email, "longenough1")).user;

/* ---------- signature verification ---------- */

test("a correctly signed payload verifies", () => {
  const body = '{"hello":"world"}';
  assert.equal(billing.verifySignature(body, sign(body)), true);
});

test("a tampered payload does not verify", () => {
  const body = '{"hello":"world"}';
  const header = sign(body);
  assert.equal(billing.verifySignature('{"hello":"evil"}', header), false);
});

test("a signature from the wrong secret does not verify", () => {
  const body = '{"a":1}';
  assert.equal(billing.verifySignature(body, sign(body, { secret: "whsec_wrong" })), false);
});

test("malformed and missing signature headers are rejected", () => {
  const body = '{"a":1}';
  for (const header of ["", "garbage", "t=123", "v1=abc", undefined, null]) {
    assert.equal(billing.verifySignature(body, header), false, `should reject ${JSON.stringify(header)}`);
  }
});

test("a v1 of the wrong length is rejected rather than throwing", () => {
  // timingSafeEqual throws on length mismatch — it must be caught, not propagated.
  const body = '{"a":1}';
  const t = Math.floor(Date.now() / 1000);
  assert.equal(billing.verifySignature(body, `t=${t},v1=short`), false);
});

test("a stale signature is rejected even though the HMAC is valid", () => {
  // The captured-webhook replay case: signature is genuine, timestamp is old.
  const body = '{"a":1}';
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  const header = sign(body, { at: tenMinutesAgo });
  assert.equal(billing.verifySignature(body, header), false, "10-minute-old delivery must not verify");
  // ...and it would have passed without the freshness window:
  assert.equal(
    billing.verifySignature(body, header, { toleranceSeconds: 3600 }),
    true,
    "the HMAC itself is valid — only the age rejects it"
  );
});

test("a future-dated signature is rejected too", () => {
  const body = '{"a":1}';
  const header = sign(body, { at: Date.now() + 10 * 60 * 1000 });
  assert.equal(billing.verifySignature(body, header), false);
});

test("a signature just inside the tolerance still verifies", () => {
  const body = '{"a":1}';
  const header = sign(body, { at: Date.now() - 60 * 1000 });
  assert.equal(billing.verifySignature(body, header), true);
});

test("verification fails closed when no webhook secret is configured", () => {
  const body = '{"a":1}';
  assert.equal(billing.verifySignature(body, sign(body), { secret: "" }), false);
});

/* ---------- webhook handling ---------- */

test("an unsigned webhook is refused before any user is touched", async () => {
  const user = await newUser("unsigned@example.com");
  const payload = JSON.stringify({
    id: "evt_unsigned",
    type: "checkout.session.completed",
    data: { object: { client_reference_id: user.id, metadata: { type: "pack", credits: "200" } } },
  });
  const res = await billing.handleWebhook(payload, "t=1,v1=deadbeef");
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);

  const after = await store.getUserById(user.id);
  assert.equal(after.bonusCredits || 0, 0, "no credits may be granted on a bad signature");
});

test("a signed credit-pack purchase grants credits once", async () => {
  const user = await newUser("pack@example.com");
  const payload = JSON.stringify({
    id: "evt_pack_1",
    type: "checkout.session.completed",
    data: { object: { client_reference_id: user.id, customer: "cus_1", metadata: { type: "pack", credits: "200" } } },
  });

  const res = await billing.handleWebhook(payload, sign(payload));
  assert.equal(res.ok, true);
  assert.equal((await store.getUserById(user.id)).bonusCredits, 200);
});

test("replaying the same credit-pack event does not grant credits twice", async () => {
  const user = await newUser("replay@example.com");
  const payload = JSON.stringify({
    id: "evt_pack_replay",
    type: "checkout.session.completed",
    data: { object: { client_reference_id: user.id, customer: "cus_2", metadata: { type: "pack", credits: "500" } } },
  });
  const header = sign(payload);

  await billing.handleWebhook(payload, header);
  assert.equal((await store.getUserById(user.id)).bonusCredits, 500);

  // Stripe retries, or someone replays the captured delivery.
  const second = await billing.handleWebhook(payload, header);
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true, "the replay should be recognised, not applied");
  assert.equal(
    (await store.getUserById(user.id)).bonusCredits,
    500,
    "a replayed pack purchase must not stack credits"
  );

  // A genuinely different purchase still lands.
  const other = JSON.stringify({
    id: "evt_pack_second",
    type: "checkout.session.completed",
    data: { object: { client_reference_id: user.id, customer: "cus_2", metadata: { type: "pack", credits: "50" } } },
  });
  await billing.handleWebhook(other, sign(other));
  assert.equal((await store.getUserById(user.id)).bonusCredits, 550);
});

test("a signed subscription upgrade sets the plan and links the customer", async () => {
  const user = await newUser("sub@example.com");
  const payload = JSON.stringify({
    id: "evt_sub_1",
    type: "checkout.session.completed",
    data: { object: { client_reference_id: user.id, customer: "cus_sub", metadata: { plan: "creator" } } },
  });

  await billing.handleWebhook(payload, sign(payload));
  const saved = await store.getUserById(user.id);
  assert.equal(saved.plan, "creator");
  assert.equal(saved.stripeCustomer, "cus_sub");
});

test("a cancelled subscription drops the user back to free, once", async () => {
  const user = await newUser("cancel@example.com");
  const upgrade = JSON.stringify({
    id: "evt_up",
    type: "checkout.session.completed",
    data: { object: { client_reference_id: user.id, customer: "cus_cancel", metadata: { plan: "studio" } } },
  });
  await billing.handleWebhook(upgrade, sign(upgrade));
  assert.equal((await store.getUserById(user.id)).plan, "studio");

  const cancel = JSON.stringify({
    id: "evt_cancel",
    type: "customer.subscription.deleted",
    data: { object: { customer: "cus_cancel" } },
  });
  await billing.handleWebhook(cancel, sign(cancel));
  assert.equal((await store.getUserById(user.id)).plan, "free");

  const replay = await billing.handleWebhook(cancel, sign(cancel));
  assert.equal(replay.duplicate, true);
});

test("an event for an unknown user is accepted but changes nothing", async () => {
  const payload = JSON.stringify({
    id: "evt_ghost",
    type: "checkout.session.completed",
    data: { object: { client_reference_id: "no-such-user", metadata: { type: "pack", credits: "200" } } },
  });
  const res = await billing.handleWebhook(payload, sign(payload));
  assert.equal(res.ok, true);
});

test("an unrecognised event type is acknowledged without side effects", async () => {
  const user = await newUser("ignored@example.com");
  const payload = JSON.stringify({
    id: "evt_other",
    type: "invoice.payment_failed",
    data: { object: { client_reference_id: user.id, metadata: { type: "pack", credits: "999" } } },
  });
  const res = await billing.handleWebhook(payload, sign(payload));
  assert.equal(res.ok, true);
  assert.equal((await store.getUserById(user.id)).bonusCredits || 0, 0);
});

test("a signed but non-JSON body is rejected rather than throwing", async () => {
  const payload = "not json at all";
  const res = await billing.handleWebhook(payload, sign(payload));
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
});

test("the seen-event list stays bounded", async () => {
  const user = await newUser("bounded@example.com");
  for (let i = 0; i < 60; i++) {
    const payload = JSON.stringify({
      id: `evt_bulk_${i}`,
      type: "checkout.session.completed",
      data: { object: { client_reference_id: user.id, metadata: { plan: "creator" } } },
    });
    await billing.handleWebhook(payload, sign(payload));
  }
  const saved = await store.getUserById(user.id);
  assert.ok(saved.processedEvents.length <= 50, "processedEvents must not grow without bound");
  assert.ok(saved.processedEvents.includes("evt_bulk_59"), "the most recent event is retained");
});

/* ---------- module configuration (from the suite added on main) ---------- */

test("stripeEnabled and creditPacksEnabled are booleans, off without config", () => {
  assert.equal(typeof billing.stripeEnabled, "boolean");
  assert.equal(typeof billing.creditPacksEnabled, "boolean");
  // No STRIPE_SECRET_KEY is set in this suite, so both must be off.
  assert.equal(billing.stripeEnabled, false);
  assert.equal(billing.creditPacksEnabled, false);
});

test("checkout helpers refuse to run when Stripe is not configured", async () => {
  await assert.rejects(
    () => billing.createCheckout({ user: { id: "u", email: "a@b.co" }, plan: "creator", origin: "http://x" }),
    /not configured/i
  );
  await assert.rejects(
    () => billing.createPackCheckout({ user: { id: "u", email: "a@b.co" }, pack: "pack50", origin: "http://x" }),
    /not configured/i
  );
});
