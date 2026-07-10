// Accounts, password hashing, signed tokens, and monthly credit tracking.
import crypto from "node:crypto";
import { getUser, getUserById, saveUser, listUsers } from "./store.js";
import { PLAN_CREDITS as CATALOG_CREDITS } from "./products.js";

// Bonus credits each side earns when a referral converts to a paid action.
export const REFERRAL_BONUS = 25;

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

// Plans → monthly credit allowance (Infinity = unlimited). Sourced from the
// product catalog so pricing and enforcement can never drift apart.
export const PLAN_CREDITS = CATALOG_CREDITS;

// Short, unambiguous referral code (no easily-confused chars).
function makeReferralCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[crypto.randomInt(alphabet.length)];
  return code;
}

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
  const extra = user.extraCredits || 0;
  const monthlyLeft = allow === Infinity ? Infinity : Math.max(0, allow - (user.creditsUsed || 0));
  return {
    id: user.id,
    email: user.email,
    plan: user.plan,
    creditsUsed: user.creditsUsed || 0,
    creditsAllowed: allow === Infinity ? "unlimited" : allow,
    // Monthly allowance remaining plus any one-time top-up balance.
    creditsLeft: allow === Infinity ? "unlimited" : monthlyLeft + extra,
    extraCredits: extra,
    referralCode: user.referralCode || null,
    referrals: user.referrals || 0,
    templates: user.templates || [],
    addOns: user.addOns || [],
  };
}

// ---- account ops ----
export async function signup(email, password, refCode) {
  email = String(email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Invalid email");
  if (String(password || "").length < 6) throw new Error("Password too short (min 6)");
  if (await getUser(email)) throw new Error("Account already exists");

  // Resolve an inbound referral code to the referring user (self-referral is a no-op).
  const referrer = refCode ? await getUserByReferral(refCode) : null;

  const user = {
    id: crypto.randomUUID(),
    email,
    pass: hashPassword(password),
    plan: "free",
    creditsUsed: 0,
    extraCredits: 0,
    referralCode: makeReferralCode(),
    referredBy: referrer?.id || null,
    referrals: 0,
    templates: [],
    addOns: [],
    period: currentPeriod(),
    createdAt: Date.now(),
  };
  await saveUser(user);

  // Reward both sides immediately on signup — a friendly welcome bonus that
  // also gives new users a reason to share their link.
  if (referrer && referrer.id !== user.id) {
    user.extraCredits += REFERRAL_BONUS;
    referrer.extraCredits = (referrer.extraCredits || 0) + REFERRAL_BONUS;
    referrer.referrals = (referrer.referrals || 0) + 1;
    await saveUser(user);
    await saveUser(referrer);
  }
  return { token: makeToken(user.id), user: publicUser(user) };
}

// Look up a user by their referral code (linear scan on the file backend,
// indexed via the JSONB column on Postgres — fine at this scale).
async function getUserByReferral(code) {
  const clean = String(code || "").trim().toUpperCase();
  if (!clean) return null;
  const all = (await listUsers()) || [];
  return all.find((u) => (u.referralCode || "").toUpperCase() === clean) || null;
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

// Returns { ok } or { ok:false, reason }. Deducts 1 credit when ok — from the
// monthly allowance first, then from any purchased one-time top-up balance.
export async function spendCredit(user) {
  if (!user) return { ok: true, anonymous: true };
  ensurePeriod(user);
  const allow = PLAN_CREDITS[user.plan] ?? PLAN_CREDITS.free;
  if (allow === Infinity) return { ok: true };

  if ((user.creditsUsed || 0) < allow) {
    user.creditsUsed = (user.creditsUsed || 0) + 1;
    await saveUser(user);
    return { ok: true, source: "monthly" };
  }
  if ((user.extraCredits || 0) > 0) {
    user.extraCredits -= 1;
    await saveUser(user);
    return { ok: true, source: "topup" };
  }
  return { ok: false, reason: "out_of_credits" };
}

// Give back 1 credit (used when a paid action fails after spending). Returns it
// to whichever bucket it came from so balances stay honest.
export async function refundCredit(user, source = "monthly") {
  if (!user) return;
  ensurePeriod(user);
  if (source === "topup") {
    user.extraCredits = (user.extraCredits || 0) + 1;
  } else {
    user.creditsUsed = Math.max(0, (user.creditsUsed || 0) - 1);
  }
  await saveUser(user);
}

// Grant one-time top-up credits (from a credit-pack purchase or a reward).
export async function addCredits(user, n) {
  if (!user || !Number.isFinite(n) || n <= 0) return;
  user.extraCredits = (user.extraCredits || 0) + Math.floor(n);
  await saveUser(user);
}

// Unlock a purchased marketplace template for this account.
export async function unlockTemplate(user, templateId) {
  if (!user || !templateId) return;
  user.templates = Array.from(new Set([...(user.templates || []), templateId]));
  await saveUser(user);
}

// Attach a purchased add-on (extra seat, brand kit, priority rendering, …).
export async function grantAddOn(user, addOnId) {
  if (!user || !addOnId) return;
  user.addOns = Array.from(new Set([...(user.addOns || []), addOnId]));
  await saveUser(user);
}

export async function setPlan(user, plan) {
  if (!user || !PLAN_CREDITS[plan]) return;
  user.plan = plan;
  await saveUser(user);
}
