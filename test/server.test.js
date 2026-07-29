import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Runs the real app in-process against an isolated JSON store (temp DATA_DIR)
// and drives the whole API over HTTP on an ephemeral port. No secrets required —
// the server runs in demo mode, so every AI route returns its built-in
// placeholder output.

let server, dataDir, BASE;

const api = async (method, route, { token, body } = {}) => {
  const res = await fetch(BASE + route, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
};

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "reelmint-test-"));
  // Env must be set before importing the server — its modules read it at load.
  process.env.DATA_DIR = dataDir;
  process.env.AUTH_SECRET = "test-secret";

  // The app is run in-process rather than spawned: a child process is invisible
  // to `--experimental-test-coverage`, so every route here reported 0% coverage
  // no matter how thoroughly it was exercised.
  const { app, initStore } = await import("../server/index.js");
  await initStore();
  server = app.listen(0);
  await once(server, "listening");
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test("health reports demo mode", async () => {
  const r = await api("GET", "/api/health");
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.enabled, false);
  assert.equal(r.body.model, "demo");
});

test("config exposes plans and disabled billing without a signed-in user", async () => {
  const r = await api("GET", "/api/config");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.plans) && r.body.plans.length === 3);
  assert.equal(r.body.stripe, false);
  assert.equal(r.body.imageProvider, "smartslide");
  assert.equal(r.body.user, null);
});

test("config exposes credit packs and (disabled) pack purchasing", async () => {
  const r = await api("GET", "/api/config");
  assert.ok(Array.isArray(r.body.creditPacks) && r.body.creditPacks.length === 3);
  assert.equal(r.body.creditPacksEnabled, false);
  for (const p of r.body.creditPacks) {
    assert.ok(p.id && p.credits > 0 && p.price);
  }
});

test("signup validates email and password, and blocks duplicates", async () => {
  const badEmail = await api("POST", "/api/auth/signup", { body: { email: "nope", password: "longenough" } });
  assert.equal(badEmail.status, 400);

  const shortPass = await api("POST", "/api/auth/signup", { body: { email: "a@b.co", password: "12345" } });
  assert.equal(shortPass.status, 400);

  const ok = await api("POST", "/api/auth/signup", { body: { email: "creator@example.com", password: "secret123" } });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  assert.equal(ok.body.user.plan, "free");
  assert.equal(ok.body.user.creditsLeft, 5);

  const dup = await api("POST", "/api/auth/signup", { body: { email: "creator@example.com", password: "secret123" } });
  assert.equal(dup.status, 400);
});

test("login rejects wrong passwords and returns a token on success", async () => {
  const wrong = await api("POST", "/api/auth/login", { body: { email: "creator@example.com", password: "nope" } });
  assert.equal(wrong.status, 400);

  const ok = await api("POST", "/api/auth/login", { body: { email: "creator@example.com", password: "secret123" } });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
});

test("/api/me reflects the bearer token", async () => {
  const anon = await api("GET", "/api/me");
  assert.equal(anon.body.user, null);

  const { body: { token } } = await api("POST", "/api/auth/login", { body: { email: "creator@example.com", password: "secret123" } });
  const me = await api("GET", "/api/me", { token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, "creator@example.com");
});

test("/api/script requires a topic and returns a decorated storyboard", async () => {
  const missing = await api("POST", "/api/script", { body: { topic: "  " } });
  assert.equal(missing.status, 400);

  const r = await api("POST", "/api/script", { body: { topic: "cold brew coffee", durationSec: 30 } });
  assert.equal(r.status, 200);
  assert.ok(r.body.title && r.body.hook);
  assert.ok(Array.isArray(r.body.scenes) && r.body.scenes.length >= 3);
  // Every scene is decorated with the fields the UI relies on.
  for (const s of r.body.scenes) {
    assert.ok(typeof s.caption === "string");
    assert.ok(typeof s.voiceover === "string");
    assert.ok(typeof s.imagePrompt === "string");
    assert.ok(s.palette && s.palette.bg);
  }
});

test("scripting spends credits and stops at the free-plan limit", async () => {
  const signup = await api("POST", "/api/auth/signup", { body: { email: "spender@example.com", password: "secret123" } });
  const token = signup.body.token;
  assert.equal(signup.body.user.creditsLeft, 5);

  // Free plan = 5 credits. Spend all five.
  for (let i = 0; i < 5; i++) {
    const r = await api("POST", "/api/script", { token, body: { topic: `idea ${i}` } });
    assert.equal(r.status, 200, `script ${i} should succeed`);
    assert.equal(r.body.user.creditsLeft, 4 - i);
  }
  // The sixth is out of credits.
  const overdrawn = await api("POST", "/api/script", { token, body: { topic: "one too many" } });
  assert.equal(overdrawn.status, 402);
  assert.equal(overdrawn.body.error, "out_of_credits");
});

test("billing checkout is gated on auth and Stripe configuration", async () => {
  const anon = await api("POST", "/api/billing/checkout", { body: { plan: "creator" } });
  assert.equal(anon.status, 401);

  const { body: { token } } = await api("POST", "/api/auth/login", { body: { email: "creator@example.com", password: "secret123" } });
  const noStripe = await api("POST", "/api/billing/checkout", { token, body: { plan: "creator" } });
  assert.equal(noStripe.status, 400);
});

test("captions, repurpose and image routes return demo output", async () => {
  const captions = await api("POST", "/api/captions", { body: { topic: "launch day", platform: "instagram" } });
  assert.equal(captions.status, 200);
  assert.ok(typeof captions.body.text === "string" && captions.body.text.length > 0);

  const noTopic = await api("POST", "/api/captions", { body: {} });
  assert.equal(noTopic.status, 400);

  const repurpose = await api("POST", "/api/repurpose", { body: { transcript: "a long talk about shipping software", count: 2 } });
  assert.equal(repurpose.status, 200);
  assert.ok(Array.isArray(repurpose.body.clips) && repurpose.body.clips.length >= 1);

  const image = await api("POST", "/api/image", { body: { prompt: "a neon skyline" } });
  assert.equal(image.status, 200);
  assert.equal(image.body.type, "design");
  assert.ok(image.body.design && image.body.design.palette);
});

test("scan requires an image payload", async () => {
  const r = await api("POST", "/api/scan", { body: {} });
  assert.equal(r.status, 400);
});

test("unknown API routes return a JSON 404, not the SPA shell", async () => {
  const get = await api("GET", "/api/does-not-exist");
  assert.equal(get.status, 404);
  assert.equal(get.body.error, "not_found");

  const post = await api("POST", "/api/nope", { body: { any: "thing" } });
  assert.equal(post.status, 404);
  assert.equal(post.body.error, "not_found");
});

test("trend radar returns a growth kit with a hook score", async () => {
  const missing = await api("POST", "/api/trends", { body: { topic: "  " } });
  assert.equal(missing.status, 400);

  const r = await api("POST", "/api/trends", { body: { topic: "morning routines", platform: "tiktok" } });
  assert.equal(r.status, 200);
  assert.ok(r.body.hashtags && Array.isArray(r.body.hashtags.broad) && Array.isArray(r.body.hashtags.niche));
  assert.ok(Array.isArray(r.body.bestTimes) && r.body.bestTimes.length >= 1);
  assert.ok(Array.isArray(r.body.hookAngles) && r.body.hookAngles.length >= 1);
  assert.ok(r.body.hookScore && typeof r.body.hookScore.score === "number");
  assert.ok(r.body.hookScore.score >= 0 && r.body.hookScore.score <= 100);
});

test("campaign studio is gated on auth and a premium plan", async () => {
  const anon = await api("POST", "/api/campaign", { body: { theme: "strength training", count: 5 } });
  assert.equal(anon.status, 401);

  const { body: { token } } = await api("POST", "/api/auth/login", { body: { email: "creator@example.com", password: "secret123" } });
  const gated = await api("POST", "/api/campaign", { token, body: { theme: "strength training", count: 5 } });
  assert.equal(gated.status, 403);
  assert.equal(gated.body.error, "premium_required");

  const missing = await api("POST", "/api/campaign", { token, body: { theme: "  " } });
  assert.equal(missing.status, 400);
});

test("brand kit is gated on auth and a premium plan", async () => {
  const anon = await api("POST", "/api/brandkit", { body: { name: "X" } });
  assert.equal(anon.status, 401);

  const { body: { token } } = await api("POST", "/api/auth/login", { body: { email: "creator@example.com", password: "secret123" } });
  const gated = await api("POST", "/api/brandkit", { token, body: { name: "Free Brand", accent: "#ff0000" } });
  assert.equal(gated.status, 403);
});

test("referrals grant bonus credits to both parties", async () => {
  const referrer = await api("POST", "/api/auth/signup", { body: { email: "referrer@example.com", password: "secret123" } });
  const code = referrer.body.user.referralCode;
  assert.ok(code, "signup should return a referral code");
  assert.equal(referrer.body.user.creditsLeft, 5);

  const invited = await api("POST", "/api/auth/signup", { body: { email: "invited@example.com", password: "secret123", ref: code } });
  assert.equal(invited.status, 200);
  // Invited user starts with the free 5 + 10 referral bonus = 15 spendable.
  assert.equal(invited.body.user.creditsLeft, 15);
  assert.equal(invited.body.user.bonusCredits, 10);

  // Referrer's bonus is reflected on their next fetch.
  const me = await api("GET", "/api/me", { token: referrer.body.token });
  assert.equal(me.body.user.creditsLeft, 15);
  assert.equal(me.body.user.referrals, 1);
});

test("purchased credits let a user keep minting past the monthly limit", async () => {
  // A fresh free user with referral bonus can exceed the 5/mo allowance.
  const signup = await api("POST", "/api/auth/signup", { body: { email: "poweruser@example.com", password: "secret123", ref: (await api("POST", "/api/auth/signup", { body: { email: "ref2@example.com", password: "secret123" } })).body.user.referralCode } });
  const token = signup.body.token;
  assert.equal(signup.body.user.creditsLeft, 15); // 5 monthly + 10 bonus

  // Spend all 15 successfully (5 monthly, then 10 bonus).
  for (let i = 0; i < 15; i++) {
    const r = await api("POST", "/api/script", { token, body: { topic: `idea ${i}` } });
    assert.equal(r.status, 200, `script ${i} should succeed`);
  }
  const overdrawn = await api("POST", "/api/script", { token, body: { topic: "one too many" } });
  assert.equal(overdrawn.status, 402);
});
