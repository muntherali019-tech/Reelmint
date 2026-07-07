// Accounts, password hashing, signed tokens, and monthly credit tracking.
import crypto from "node:crypto";
import { getUser, getUserById, saveUser } from "./store.js";

const SECRET =
  process.env.AUTH_SECRET ||
  (process.env.NODE_ENV === "production"
    ? null
    : "dev-only-insecure-secret-change-me");

if (!SECRET)
  console.warn(
    "auth: AUTH_SECRET is not set — login tokens will not be stable. Set it in production."
  );

const SECRET_KEY = SECRET || crypto.randomBytes(32).toString("hex");

// Plans → monthly credit allowance (Infinity = unlimited).
export const PLAN_CREDITS = { free: 5, creator: 100, studio: Infinity };

// ---- password hashing (scrypt) ----
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(test, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- tokens (HMAC-signed, no external dep) ----
export function makeToken(userId) {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 30; // 30 days
  const body = `${userId}.${exp}`;
  const sig = crypto.createHmac("sha256", SECRET_KEY).update(body).digest("hex");
  return `${body}.${sig}`;
}
export function verifyToken(token) {
  if (!token) return null;
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts;
  const expected = crypto
    .createHmac("sha256", SECRET_KEY)
    .update(`${userId}.${exp}`)
    .digest("hex");
  if (sig !== expected) return null;
  if (Date.now() > Number(exp)) return null;
  return userId;
}

// ---- monthly credit window ----
function currentPeriod() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
}
function ensurePeriod(user) {
  const p = currentPeriod();
  if (user.period !== p) {
    user.period = p;
    user.creditsUsed = 0;
  }
}

export function publicUser(user) {
  if (!user) return null;
  ensurePeriod(user);
  const allow = PLAN_CREDITS[user.plan] ?? PLAN_CREDITS.free;
  return {
    id: user.id,
    email: user.email,
    plan: user.plan,
    creditsUsed: user.creditsUsed || 0,
    creditsAllowed: allow === Infinity ? "unlimited" : allow,
    creditsLeft: allow === Infinity ? "unlimited" : Math.max(0, allow - (user.creditsUsed || 0)),
  };
}

// ---- account ops ----
export async function signup(email, password) {
  email = String(email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Invalid email");
  if (String(password || "").length < 6) throw new Error("Password too short (min 6)");
  if (await getUser(email)) throw new Error("Account already exists");
  const user = {
    id: crypto.randomUUID(),
    email,
    pass: hashPassword(password),
    plan: "free",
    creditsUsed: 0,
    period: currentPeriod(),
    createdAt: Date.now(),
  };
  await saveUser(user);
  return { token: makeToken(user.id), user: publicUser(user) };
}

export async function login(email, password) {
  const user = await getUser(email);
  if (!user || !verifyPassword(password, user.pass)) throw new Error("Wrong email or password");
  return { token: makeToken(user.id), user: publicUser(user) };
}

// Express middleware — attaches req.user (or null) from the Bearer token.
export async function attachUser(req, _res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    const id = verifyToken(token);
    req.user = id ? await getUserById(id) : null;
  } catch {
    req.user = null;
  }
  next();
}

// Returns { ok } or { ok:false, reason }. Deducts 1 credit when ok.
export async function spendCredit(user) {
  if (!user) return { ok: true, anonymous: true };
  ensurePeriod(user);
  const allow = PLAN_CREDITS[user.plan] ?? PLAN_CREDITS.free;
  if (allow !== Infinity && (user.creditsUsed || 0) >= allow) {
    return { ok: false, reason: "out_of_credits" };
  }
  user.creditsUsed = (user.creditsUsed || 0) + 1;
  await saveUser(user);
  return { ok: true };
}

// Give back 1 credit (used when a paid action fails after spending).
export async function refundCredit(user) {
  if (!user) return;
  ensurePeriod(user);
  user.creditsUsed = Math.max(0, (user.creditsUsed || 0) - 1);
  await saveUser(user);
}

export async function setPlan(user, plan) {
  if (!user || !PLAN_CREDITS[plan]) return;
  user.plan = plan;
  await saveUser(user);
}
