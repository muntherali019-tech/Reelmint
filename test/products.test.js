// Catalog integrity — the storefront and billing both trust products.js, so a
// broken SKU here becomes a broken checkout. These run with `node --test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLANS,
  PLAN_CREDITS,
  CREDIT_PACKS,
  ADDONS,
  TEMPLATES,
  PRODUCTS_BY_ID,
  findProduct,
  catalog,
} from "../server/products.js";

test("every plan has a matching credit allowance", () => {
  for (const p of PLANS) {
    assert.ok(p.id in PLAN_CREDITS, `plan ${p.id} missing from PLAN_CREDITS`);
  }
});

test("the four expected plan tiers exist", () => {
  const ids = PLANS.map((p) => p.id);
  assert.deepEqual(ids, ["free", "creator", "studio", "agency"]);
});

test("credit packs grant credits and have a positive price", () => {
  assert.ok(CREDIT_PACKS.length >= 3);
  for (const p of CREDIT_PACKS) {
    assert.ok(p.credits > 0, `${p.id} should grant credits`);
    assert.ok(p.amount > 0, `${p.id} should cost something`);
  }
});

test("marketplace templates carry a creator revenue share", () => {
  assert.ok(TEMPLATES.length >= 1);
  for (const t of TEMPLATES) {
    assert.ok(t.creatorShare > 0 && t.creatorShare <= 1, `${t.id} share out of range`);
    assert.ok(t.amount > 0);
  }
});

test("product ids are globally unique across every line", () => {
  const all = [...CREDIT_PACKS, ...ADDONS, ...TEMPLATES];
  const ids = all.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate product id found");
});

test("findProduct resolves any SKU and rejects unknowns", () => {
  assert.equal(findProduct("pack_pro")?.id, "pack_pro");
  assert.equal(findProduct("nope"), null);
  assert.equal(findProduct(""), null);
  assert.equal(Object.keys(PRODUCTS_BY_ID).length, CREDIT_PACKS.length + ADDONS.length + TEMPLATES.length);
});

test("catalog() exposes all four revenue lines", () => {
  const c = catalog();
  assert.ok(c.plans && c.creditPacks && c.addOns && c.templates);
});
