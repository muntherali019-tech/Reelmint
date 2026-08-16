// Catalog integrity — the storefront, checkout and credit accounting all read
// products.js, so a broken SKU here becomes a broken checkout. These run with
// `node --test`; no Stripe account, keys or network involved.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CURRENCY,
  PLANS,
  PAID_PLANS,
  PLAN_CREDITS,
  CREDIT_PACKS,
  PRODUCTS_BY_ID,
  findPlan,
  findPack,
  findProduct,
  catalog,
} from "../server/products.js";
import { PLAN_CREDITS as AUTH_PLAN_CREDITS } from "../server/auth.js";

// Display strings are what the customer reads before clicking Buy; `amount` is
// what Stripe actually charges. A mismatch is a mis-priced sale.
const dollars = (cents) => `$${cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2)}`;

test("the expected plan tiers exist, in order", () => {
  assert.deepEqual(PLANS.map((p) => p.id), ["free", "creator", "studio"]);
});

test("every plan has a matching credit allowance", () => {
  for (const p of PLANS) {
    assert.ok(p.id in PLAN_CREDITS, `plan ${p.id} missing from PLAN_CREDITS`);
  }
  // ...and no allowance exists for a plan nobody can buy or be assigned.
  for (const id of Object.keys(PLAN_CREDITS)) {
    assert.ok(findPlan(id), `PLAN_CREDITS has an orphan plan ${id}`);
  }
});

test("auth.js and the catalog share one PLAN_CREDITS table", () => {
  // setPlan() silently no-ops for a plan missing from auth's table, so a paid
  // upgrade to a tier auth doesn't know about would take money and grant nothing.
  assert.equal(AUTH_PLAN_CREDITS, PLAN_CREDITS);
});

test("paid plans are chargeable and recurring; free is not", () => {
  assert.deepEqual(PAID_PLANS.map((p) => p.id), ["creator", "studio"]);
  for (const p of PAID_PLANS) {
    assert.ok(p.amount > 0, `${p.id} needs an amount to build a Checkout session`);
    assert.equal(p.interval, "month", `${p.id} needs an interval for mode:subscription`);
    assert.equal(p.price, dollars(p.amount), `${p.id} display price disagrees with amount`);
  }
  assert.equal(findPlan("free").amount, 0);
  assert.equal(findPlan("free").interval, undefined);
});

test("credit packs grant credits and have a matching positive price", () => {
  assert.ok(CREDIT_PACKS.length >= 3);
  for (const p of CREDIT_PACKS) {
    assert.ok(p.credits > 0, `${p.id} should grant credits`);
    assert.ok(p.amount > 0, `${p.id} should cost something`);
    assert.equal(p.price, dollars(p.amount), `${p.id} display price disagrees with amount`);
    assert.equal(p.interval, undefined, `${p.id} is one-time — mode:payment rejects recurring`);
  }
});

test("bigger packs cost less per credit", () => {
  const rate = (p) => p.amount / p.credits;
  for (let i = 1; i < CREDIT_PACKS.length; i++) {
    assert.ok(
      rate(CREDIT_PACKS[i]) < rate(CREDIT_PACKS[i - 1]),
      `${CREDIT_PACKS[i].id} is not better value than ${CREDIT_PACKS[i - 1].id}`
    );
  }
});

test("the currency is a valid ISO-4217 code Stripe will accept", () => {
  assert.match(CURRENCY, /^[a-z]{3}$/);
});

test("product ids are globally unique across every line", () => {
  const ids = [...PAID_PLANS, ...CREDIT_PACKS].map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate product id found");
});

test("lookups resolve any SKU and reject unknowns", () => {
  assert.equal(findProduct("pack200")?.id, "pack200");
  assert.equal(findProduct("creator")?.id, "creator");
  assert.equal(findProduct("nope"), null);
  assert.equal(findProduct(""), null);
  assert.equal(findPack("pack200")?.credits, 200);
  assert.equal(findPack("free"), null, "a plan is not a pack");
  assert.equal(findPlan("pack200"), null, "a pack is not a plan");
  assert.equal(Object.keys(PRODUCTS_BY_ID).length, PAID_PLANS.length + CREDIT_PACKS.length);
});

test("catalog() exposes both revenue lines and leaks no server-only fields", () => {
  const c = catalog();
  assert.ok(Array.isArray(c.plans) && Array.isArray(c.creditPacks));
  assert.equal(c.plans.length, PLANS.length);
  assert.equal(c.creditPacks.length, CREDIT_PACKS.length);
  for (const item of [...c.plans, ...c.creditPacks]) {
    assert.ok(!("stripePrice" in item), `${item.id} exposes stripePrice to the browser`);
  }
});
