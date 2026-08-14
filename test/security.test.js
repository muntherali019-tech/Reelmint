// The hardening middleware is the only thing standing between an open AI
// endpoint and someone else's Anthropic bill, so it gets direct coverage.
// These are pure unit tests against fake req/res objects — no server, no ports.

import test from "node:test";
import assert from "node:assert/strict";
import { securityHeaders, cors, rateLimit } from "../server/security.js";

/** Minimal req/res doubles with just the surface the middleware touches. */
function fakeRes() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { this.ended = true; return this; },
  };
}
const fakeReq = (ip = "1.2.3.4", method = "POST") => ({ ip, method, headers: {} });

/** Runs a middleware and reports whether it called next(). */
function run(mw, req, res) {
  let nexted = false;
  mw(req, res, () => { nexted = true; });
  return nexted;
}

test("securityHeaders sets the headers that matter and always continues", () => {
  const res = fakeRes();
  assert.equal(run(securityHeaders, fakeReq(), res), true);

  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["x-frame-options"], "SAMEORIGIN");
  assert.equal(res.headers["referrer-policy"], "strict-origin-when-cross-origin");

  const csp = res.headers["content-security-policy"];
  assert.ok(csp, "a CSP is set");
  // script-src must not allow inline: the app has no inline handlers, and
  // 'unsafe-inline' here would give away the main thing the CSP buys us.
  assert.match(csp, /script-src 'self'/);
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), "script-src stays free of unsafe-inline");
  // Canvas export needs blob: media and data:/blob: images — keep those open.
  assert.match(csp, /img-src [^;]*blob:/);
  assert.match(csp, /media-src [^;]*blob:/);
});

test("HSTS is production-only", () => {
  const prior = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "development";
    const dev = fakeRes();
    run(securityHeaders, fakeReq(), dev);
    assert.equal(dev.headers["strict-transport-security"], undefined);

    process.env.NODE_ENV = "production";
    const prod = fakeRes();
    run(securityHeaders, fakeReq(), prod);
    assert.match(prod.headers["strict-transport-security"], /max-age=\d+/);
  } finally {
    process.env.NODE_ENV = prior;
  }
});

test("cors stays closed for an origin that is not on the allowlist", () => {
  // CORS_ORIGIN is unset in tests, so the allowlist is empty and nothing should
  // get an Access-Control-Allow-Origin back — the API is same-origin by default.
  const req = fakeReq();
  req.headers.origin = "https://not-our-site.example";
  const res = fakeRes();

  assert.equal(run(cors, req, res), true, "the request still reaches the route");
  assert.equal(res.headers["access-control-allow-origin"], undefined);
});

test("cors is a no-op for same-origin requests (no Origin header)", () => {
  const res = fakeRes();
  assert.equal(run(cors, fakeReq(), res), true);
  assert.equal(res.headers["access-control-allow-origin"], undefined);
});

test("rateLimit allows up to max, then answers 429 with Retry-After", () => {
  const mw = rateLimit({ windowMs: 60_000, max: 3 });
  const req = fakeReq();

  for (let i = 1; i <= 3; i++) {
    const res = fakeRes();
    assert.equal(run(mw, req, res), true, `request ${i} passes`);
    assert.equal(res.headers["ratelimit-limit"], "3");
    assert.equal(res.headers["ratelimit-remaining"], String(3 - i));
  }

  const blocked = fakeRes();
  assert.equal(run(mw, req, blocked), false, "the 4th request does not reach the route");
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.error, "rate_limited");
  assert.ok(Number(blocked.headers["retry-after"]) > 0, "Retry-After tells the client when to come back");
});

test("rateLimit counts each client separately", () => {
  const mw = rateLimit({ windowMs: 60_000, max: 1 });

  assert.equal(run(mw, fakeReq("10.0.0.1"), fakeRes()), true);
  assert.equal(run(mw, fakeReq("10.0.0.1"), fakeRes()), false, "same client is limited");
  assert.equal(run(mw, fakeReq("10.0.0.2"), fakeRes()), true, "a different client is unaffected");
});

test("rateLimit budget refills once the window has passed", async () => {
  const mw = rateLimit({ windowMs: 20, max: 1 });
  const req = fakeReq("10.0.0.3");

  assert.equal(run(mw, req, fakeRes()), true);
  assert.equal(run(mw, req, fakeRes()), false);

  await new Promise((r) => setTimeout(r, 30));
  assert.equal(run(mw, req, fakeRes()), true, "a new window starts a fresh budget");
});
