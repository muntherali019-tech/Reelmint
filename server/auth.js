// Accounts, password hashing, signed tokens, and monthly credit tracking.
import crypto from "node:crypto";
import { getUser, getUserById, saveUser, getUserByReferral } from "./store.js";
import { PLAN_CREDITS } from "./products.js";

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

// Plans → monthly credit allowance (Infinity = unlimited). Defined alongside
// the plan catalog in products.js and re-exported here so the two can't drift.
export { PLAN_CREDITS };

// Referral reward — credits granted to BOTH parties when a referral converts.
export const REFERRAL_BONUS = Number(process.env.REFERRAL_BONUS) || 10;

// Which plans may use premium tools (brand kit, campaign studio, etc.).
export const PREMIUM_PLANS = new Set(["creator", "studio"]);
export function isPremium(user) {
  return Boolean(user && PREMIUM_PLANS.has(user.plan));
}

function newReferralCode() {
  return crypto.randomBytes(4).toString("hex"); // 8 chars, url-safe
}

// ---- password hashing (scrypt) ----
// Exported for testing: test/auth.test.js exercises them directly. They are pure
// crypto helpers and hold no secrets of their own.
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
export function verifyPassword(password, stored) {
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
  const bonus = user.bonusCredits || 0;
  const monthlyLeft = allow === Infinity ? Infinity : Math.max(0, allow - (user.creditsUsed || 0));
  return {
    id: user.id,
    email: user.email,
    plan: user.plan,
    premium: PREMIUM_PLANS.has(user.plan),
    creditsUsed: user.creditsUsed || 0,
    creditsAllowed: allow === Infinity ? "unlimited" : allow,
    bonusCredits: bonus,
    // Total credits the user can still spend this month (monthly + purchased packs).
    creditsLeft: allow === Infinity ? "unlimited" : monthlyLeft + bonus,
    referralCode: user.referralCode || null,
    referrals: user.referrals || 0,
    brandKit: user.brandKit || null,
  };
}

// ---- account ops ----
export async function signup(email, password, ref = "") {
  email = String(email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Invalid email");
  if (String(password || "").length < 6) throw new Error("Password too short (min 6)");
  if (await getUser(email)) throw new Error("Account already exists");

  // If they arrived via a referral code, reward both sides.
  const referrer = ref ? await getUserByReferral(String(ref).trim()) : null;
  const user = {
    id: crypto.randomUUID(),
    email,
    pass: hashPassword(password),
    plan: "free",
    creditsUsed: 0,
    bonusCredits: referrer ? REFERRAL_BONUS : 0,
    period: currentPeriod(),
    referralCode: newReferralCode(),
    referredBy: referrer ? referrer.id : null,
    referrals: 0,
    createdAt: Date.now(),
  };
  await saveUser(user);
  if (referrer && referrer.id !== user.id) {
    referrer.bonusCredits = (referrer.bonusCredits || 0) + REFERRAL_BONUS;
    referrer.referrals = (referrer.referrals || 0) + 1;
    await saveUser(referrer);
  }
  return { token: makeToken(user.id), user: publicUser(user) };
}


export async function login(email, password) {
  const user = await getUser(email);
  if (!user || !verifyPassword(password, user.pass)) throw new Error("Wrong email or password");
  await ensureDefaults(user);
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

// Returns { ok } or { ok:false, reason }. Deducts `cost` credits when ok.
// Monthly allowance is spent first; purchased/bonus credits cover the overflow.
export async function spendCredit(user, cost = 1) {
  if (!user) return { ok: true, anonymous: true };
  ensurePeriod(user);
  const allow = PLAN_CREDITS[user.plan] ?? PLAN_CREDITS.free;
  if (allow === Infinity) return { ok: true };

  const monthlyLeft = Math.max(0, allow - (user.creditsUsed || 0));
  const bonus = user.bonusCredits || 0;
  if (monthlyLeft + bonus < cost) return { ok: false, reason: "out_of_credits" };

  const fromMonthly = Math.min(monthlyLeft, cost);
  user.creditsUsed = (user.creditsUsed || 0) + fromMonthly;
  user.bonusCredits = bonus - (cost - fromMonthly);
  await saveUser(user);
  return { ok: true, spent: cost };
}

// Give back `cost` credits (used when a paid action fails after spending).
export async function refundCredit(user, cost = 1) {
  if (!user) return;
  ensurePeriod(user);
  // Refund to the monthly bucket first (mirrors how it was spent).
  const refundMonthly = Math.min(cost, user.creditsUsed || 0);
  user.creditsUsed = Math.max(0, (user.creditsUsed || 0) - refundMonthly);
  if (cost - refundMonthly > 0) {
    user.bonusCredits = (user.bonusCredits || 0) + (cost - refundMonthly);
  }
  await saveUser(user);
}

// Grant purchased/bonus credits (one-time credit packs, referrals, promos).
export async function grantCredits(user, n) {
  if (!user || !Number.isFinite(n) || n <= 0) return;
  user.bonusCredits = (user.bonusCredits || 0) + Math.floor(n);
  await saveUser(user);
}

// Backfill fields added after a user was first created (referral code, etc.).
export async function ensureDefaults(user) {
  if (!user) return user;
  let changed = false;
  if (!user.referralCode) { user.referralCode = newReferralCode(); changed = true; }
  if (user.bonusCredits == null) { user.bonusCredits = 0; changed = true; }
  if (changed) await saveUser(user);
  return user;
}

// ---- brand kit (premium) ----
const HEX = /^#?[0-9a-fA-F]{3,8}$/;
export async function setBrandKit(user, kit = {}) {
  if (!user) throw new Error("Sign in first");
  if (!PREMIUM_PLANS.has(user.plan)) throw new Error("Brand Kit is a Creator/Studio feature");
  const clean = (v, max) => String(v || "").slice(0, max);
  const color = (v, dflt) => (HEX.test(String(v)) ? (String(v).startsWith("#") ? v : "#" + v) : dflt);
  user.brandKit = {
    name: clean(kit.name, 40),
    handle: clean(kit.handle, 40),
    bg: color(kit.bg, "#0E1116"),
    accent: color(kit.accent, "#5B8CFF"),
    text: color(kit.text, "#F4F6FB"),
    voice: clean(kit.voice, 200), // brand voice guidance the AI can use
  };
  await saveUser(user);
  return user.brandKit;
}

export async function setPlan(user, plan) {
  if (!user || !PLAN_CREDITS[plan]) return;
  user.plan = plan;
  await saveUser(user);
}
