import test from "node:test";
import assert from "node:assert/strict";
import { aiEnabled, aiStatus, parseLooseJSON } from "../server/ai.js";

// Every structured route funnels model output through parseLooseJSON. If it ever
// throws, a paid generation 500s after the credit has been spent — so the
// contract is "always return something, never throw".

const FALLBACK = { demo: true };

test("plain JSON parses", () => {
  assert.deepEqual(parseLooseJSON('{"a":1}', FALLBACK), { a: 1 });
});

test("a fenced ```json block is unwrapped", () => {
  const raw = '```json\n{"a":1,"b":"two"}\n```';
  assert.deepEqual(parseLooseJSON(raw, FALLBACK), { a: 1, b: "two" });
});

test("a bare ``` fence is unwrapped too", () => {
  assert.deepEqual(parseLooseJSON('```\n{"a":1}\n```', FALLBACK), { a: 1 });
});

test("leading prose before the JSON is stripped", () => {
  const raw = 'Sure! Here is the storyboard spec you asked for:\n{"title":"Cat"}';
  assert.deepEqual(parseLooseJSON(raw, FALLBACK), { title: "Cat" });
});

test("trailing prose after the JSON is stripped", () => {
  const raw = '{"title":"Cat"}\n\nLet me know if you would like changes!';
  assert.deepEqual(parseLooseJSON(raw, FALLBACK), { title: "Cat" });
});

test("prose on both sides is stripped", () => {
  const raw = 'Here you go:\n```json\n{"panels":[1,2]}\n```\nHope that helps.';
  assert.deepEqual(parseLooseJSON(raw, FALLBACK), { panels: [1, 2] });
});

test("a top-level array is parsed", () => {
  assert.deepEqual(parseLooseJSON('["a","b"]', FALLBACK), ["a", "b"]);
});

test("nested braces survive the slice", () => {
  const raw = 'Result: {"outer":{"inner":{"deep":true}},"n":2} done';
  assert.deepEqual(parseLooseJSON(raw, FALLBACK), { outer: { inner: { deep: true } }, n: 2 });
});

test("truncated JSON falls back instead of throwing", () => {
  assert.deepEqual(parseLooseJSON('{"a":1,"b":', FALLBACK), FALLBACK);
});

test("empty, blank and nullish input falls back", () => {
  for (const raw of ["", null, undefined]) {
    assert.deepEqual(parseLooseJSON(raw, FALLBACK), FALLBACK, `should fall back for ${JSON.stringify(raw)}`);
  }
});

test("output with no JSON at all falls back", () => {
  assert.deepEqual(parseLooseJSON("I'm sorry, I can't help with that.", FALLBACK), FALLBACK);
});

test("invalid JSON inside a valid fence falls back", () => {
  assert.deepEqual(parseLooseJSON('```json\n{not: valid}\n```', FALLBACK), FALLBACK);
});

test("a thrown-away fallback is returned by identity, not a copy", () => {
  const sentinel = { marker: Symbol("demo") };
  assert.equal(parseLooseJSON("nonsense", sentinel), sentinel);
});

test("it never throws, whatever it is handed", () => {
  const inputs = ["{", "}", "[", "][", "```", "```json```", "{}{}", '{"a":1}]', "null", "0"];
  for (const raw of inputs) {
    assert.doesNotThrow(() => parseLooseJSON(raw, FALLBACK), `threw on ${JSON.stringify(raw)}`);
  }
});

/* ---------- module status (from the suite added on main) ---------- */

test("aiStatus reports the enabled flag and model", () => {
  const status = aiStatus();
  assert.ok(Object.hasOwn(status, "enabled"), "status should have an enabled property");
  assert.ok(Object.hasOwn(status, "model"), "status should have a model property");
});

test("aiStatus reports demo mode when no API key is configured", () => {
  if (!aiEnabled) assert.equal(aiStatus().model, "demo");
});
