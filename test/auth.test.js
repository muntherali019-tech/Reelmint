// Account, credit and referral logic against the real file-backed store.
// A throwaway DATA_DIR keeps every run isolated.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "reelmint-test-"));

const { initStore } = await import("../server/store.js");
const {
  signup,
  login,
  spendCredit,
  refundCredit,
  addCredits,
  unlockTemplate,
  publicUser,
  setPlan,
  REFERRAL_BONUS,
} = await import("../server/auth.js");
const { fulfillProduct } = await import("../server/billing.js");

before(async () => {
  await initStore();
});

let n = 0;
const email = () => `user${n++}@test.com`;

test("signup issues a token, referral code and starting credits", async () => {
  const { token, user } = await signup(email(), "password1");
  assert.ok(token);
  assert.equal(user.plan, "free");
  assert.equal(user.creditsLeft, 5);
  assert.match(user.referralCode, /^[A-Z2-9]{6}$/);
});

test("signup rejects weak passwords and duplicate emails", async () => {
  const e = email();
  await signup(e, "password1");
  await assert.rejects(() => signup(e, "password1"), /already exists/);
  await assert.rejects(() => signup(email(), "short"), /too short/);
  await assert.rejects(() => signup("not-an-email", "password1"), /Invalid email/);
});

test("login verifies the password", async () => {
  const e = email();
  await signup(e, "password1");
  await assert.rejects(() => login(e, "wrong"), /Wrong email or password/);
  const ok = await login(e, "password1");
  assert.ok(ok.token);
});

test("credits spend from the monthly allowance then top-up balance", async () => {
  const e = email();
  await signup(e, "password1");
  const { getUser } = await import("../server/store.js");
  const user = await getUser(e);

  for (let i = 0; i < 5; i++) assert.equal((await spendCredit(user)).ok, true);
  // Monthly allowance (5) exhausted → next spend fails.
  assert.equal((await spendCredit(user)).ok, false);

  // Buy a pack → spends now draw from the top-up bucket.
  await addCredits(user, 10);
  const spend = await spendCredit(user);
  assert.equal(spend.ok, true);
  assert.equal(spend.source, "topup");
  assert.equal(publicUser(user).extraCredits, 9);
});

test("refund returns a credit to the bucket it came from", async () => {
  const e = email();
  await signup(e, "password1");
  const { getUser } = await import("../server/store.js");
  const user = await getUser(e);
  await spendCredit(user); // monthly: used 1
  await refundCredit(user, "monthly");
  assert.equal(publicUser(user).creditsUsed, 0);
});

test("referral grants the bonus to both sides", async () => {
  const refEmail = email();
  const { user: referrer } = await signup(refEmail, "password1");
  const { user: invitee } = await signup(email(), "password1", referrer.referralCode);
  assert.equal(invitee.extraCredits, REFERRAL_BONUS);

  const { getUser } = await import("../server/store.js");
  const updatedReferrer = await getUser(refEmail);
  assert.equal(updatedReferrer.extraCredits, REFERRAL_BONUS);
  assert.equal(updatedReferrer.referrals, 1);
});

test("fulfilling a credit pack adds credits; a template unlocks it", async () => {
  const e = email();
  await signup(e, "password1");
  const { getUser } = await import("../server/store.js");
  const user = await getUser(e);

  await fulfillProduct(user, "pack_starter"); // 50 credits
  assert.equal(publicUser(user).extraCredits, 50);

  await fulfillProduct(user, "tpl_viral_hooks");
  assert.ok(publicUser(user).templates.includes("tpl_viral_hooks"));
});

test("setPlan only accepts known plans", async () => {
  const e = email();
  await signup(e, "password1");
  const { getUser } = await import("../server/store.js");
  const user = await getUser(e);
  await setPlan(user, "studio");
  assert.equal(publicUser(user).plan, "studio");
  await setPlan(user, "bogus");
  assert.equal(publicUser(user).plan, "studio"); // unchanged
});
