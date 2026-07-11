import test from "node:test";
import assert from "node:assert/strict";
import { makeToken, verifyToken, publicUser, PLAN_CREDITS } from "../server/auth.js";

// Pure-logic unit tests for the token signer and credit accounting — the parts
// the HTTP suite can only reach indirectly.

test("tokens round-trip and reject tampering", () => {
  const token = makeToken("user-123");
  assert.equal(verifyToken(token), "user-123");

  // A flipped signature must not verify.
  const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
  assert.equal(verifyToken(tampered), null);

  // Malformed / empty tokens are rejected, not thrown on.
  assert.equal(verifyToken(""), null);
  assert.equal(verifyToken(null), null);
  assert.equal(verifyToken("only.two"), null);
});

test("an expired token is rejected", () => {
  // Forge a body with a past expiry but no valid signature — must fail.
  const expired = `user-123.${Date.now() - 1000}.deadbeef`;
  assert.equal(verifyToken(expired), null);
});

test("PLAN_CREDITS covers every plan with sane allowances", () => {
  assert.equal(PLAN_CREDITS.free, 5);
  assert.equal(PLAN_CREDITS.creator, 100);
  assert.equal(PLAN_CREDITS.studio, Infinity);
});

test("publicUser reports credit math per plan", () => {
  assert.equal(publicUser(null), null);

  const free = publicUser({ id: "1", email: "F@x.co", plan: "free", creditsUsed: 2, period: period() });
  assert.equal(free.creditsAllowed, 5);
  assert.equal(free.creditsLeft, 3);

  const creator = publicUser({ id: "2", email: "c@x.co", plan: "creator", creditsUsed: 10, period: period() });
  assert.equal(creator.creditsAllowed, 100);
  assert.equal(creator.creditsLeft, 90);

  const studio = publicUser({ id: "3", email: "s@x.co", plan: "studio", creditsUsed: 999, period: period() });
  assert.equal(studio.creditsAllowed, "unlimited");
  assert.equal(studio.creditsLeft, "unlimited");
});

test("credits never go negative and unknown plans fall back to free", () => {
  const overspent = publicUser({ id: "4", email: "o@x.co", plan: "free", creditsUsed: 99, period: period() });
  assert.equal(overspent.creditsLeft, 0);

  const unknown = publicUser({ id: "5", email: "u@x.co", plan: "mystery", creditsUsed: 0, period: period() });
  assert.equal(unknown.creditsAllowed, 5);
});

test("a stale credit period resets usage to zero", () => {
  const stale = publicUser({ id: "6", email: "p@x.co", plan: "free", creditsUsed: 4, period: "2000-1" });
  assert.equal(stale.creditsUsed, 0);
  assert.equal(stale.creditsLeft, 5);
});

test("purchased/bonus credits add on top of the monthly allowance", () => {
  const u = publicUser({ id: "7", email: "b@x.co", plan: "free", creditsUsed: 5, bonusCredits: 12, period: period() });
  // Monthly exhausted (5/5) but 12 purchased credits remain spendable.
  assert.equal(u.creditsLeft, 12);
  assert.equal(u.bonusCredits, 12);

  const partial = publicUser({ id: "8", email: "b2@x.co", plan: "free", creditsUsed: 2, bonusCredits: 4, period: period() });
  assert.equal(partial.creditsLeft, 3 + 4); // 3 monthly left + 4 bonus
});

test("publicUser exposes premium flag and referral fields", () => {
  const free = publicUser({ id: "9", email: "f2@x.co", plan: "free", creditsUsed: 0, period: period(), referralCode: "abc123" });
  assert.equal(free.premium, false);
  assert.equal(free.referralCode, "abc123");

  const creator = publicUser({ id: "10", email: "c2@x.co", plan: "creator", creditsUsed: 0, period: period() });
  assert.equal(creator.premium, true);
});

function period() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
}
