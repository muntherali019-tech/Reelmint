import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Boots the real server against an isolated JSON store (temp DATA_DIR) and
// drives the whole API over HTTP. No secrets required — the server runs in
// demo mode, so every AI route returns its built-in placeholder output.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 17000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
let proc, dataDir;

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
  proc = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, AUTH_SECRET: "test-secret" },
    stdio: "ignore",
  });
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start");
});

after(() => {
  proc?.kill();
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
