// Stripe Checkout + webhook handling via the Stripe REST API (no SDK needed).
// Gracefully no-ops when Stripe env vars are absent.
import crypto from "node:crypto";
import { getUserById, getUserByStripeCustomer } from "./store.js";
import { setPlan, grantCredits } from "./auth.js";
import { CURRENCY, CREDIT_PACKS, findPack, findPlan } from "./products.js";

const SECRET = process.env.STRIPE_SECRET_KEY || "";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

export { CREDIT_PACKS };

// A secret key is the only thing checkout needs: every SKU in products.js
// carries its own `amount`, so sessions are built from inline `price_data`
// rather than Price IDs that have to be hand-created in the Stripe dashboard
// first. Setting STRIPE_PRICE_* on a SKU still overrides the inline amount.
export const stripeEnabled = Boolean(SECRET);
export const creditPacksEnabled = Boolean(SECRET);

// Build the `line_items[0]` params for a SKU. Prefers a configured dashboard
// Price; otherwise describes the charge inline. `interval` (e.g. "month") makes
// it recurring — required for `mode: "subscription"`, invalid for `"payment"`.
// Pure and exported so the shape can be asserted without touching Stripe.
export function buildLineItem(sku, { interval } = {}) {
  if (!sku) throw new Error("Unknown product");
  const item = { "line_items[0][quantity]": "1" };
  if (sku.stripePrice) return { ...item, "line_items[0][price]": sku.stripePrice };
  if (!(sku.amount > 0)) throw new Error("Unknown product");
  const p = "line_items[0][price_data]";
  const inline = {
    ...item,
    [`${p}[currency]`]: CURRENCY,
    [`${p}[unit_amount]`]: String(sku.amount),
    [`${p}[product_data][name]`]: `Reelmint ${sku.name || sku.label}`,
  };
  if (sku.blurb) inline[`${p}[product_data][description]`] = sku.blurb;
  if (interval) inline[`${p}[recurring][interval]`] = interval;
  return inline;
}

async function stripe(endpoint, params) {
  const res = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${SECRET}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || "Stripe error");
  return json;
}

// Create a subscription Checkout session for a plan.
export async function createCheckout({ user, plan, origin }) {
  if (!stripeEnabled) throw new Error("Stripe is not configured");
  const def = findPlan(plan);
  if (!def || !(def.amount > 0)) throw new Error("Unknown plan");
  const session = await stripe("checkout/sessions", {
    mode: "subscription",
    ...buildLineItem(def, { interval: def.interval || "month" }),
    client_reference_id: user.id,
    customer_email: user.email,
    "metadata[plan]": plan,
    "metadata[userId]": user.id,
    success_url: `${origin}/?upgraded=${plan}`,
    cancel_url: `${origin}/?canceled=1`,
  });
  return session.url;
}

// Create a one-time Checkout session for a credit pack.
export async function createPackCheckout({ user, pack, origin }) {
  if (!creditPacksEnabled) throw new Error("Credit packs are not configured");
  const def = findPack(pack);
  if (!def) throw new Error("Unknown pack");
  const session = await stripe("checkout/sessions", {
    mode: "payment",
    ...buildLineItem(def),
    client_reference_id: user.id,
    customer_email: user.email,
    "metadata[type]": "pack",
    "metadata[credits]": String(def.credits),
    "metadata[userId]": user.id,
    success_url: `${origin}/?credits=${def.credits}`,
    cancel_url: `${origin}/?canceled=1`,
  });
  return session.url;
}

// How far out of date a signature's timestamp may be. Stripe signs `t.payload`,
// so without checking `t` for freshness a captured webhook stays replayable
// forever. 5 minutes matches Stripe's own default tolerance.
const TOLERANCE_SECONDS = Number(process.env.STRIPE_WEBHOOK_TOLERANCE || 300);

// Verify Stripe's webhook signature against the raw request body. `now`,
// `secret` and `toleranceSeconds` are injectable so this can be tested without
// touching the environment or waiting on the clock.
export function verifySignature(
  rawBody,
  header,
  { now = Date.now(), secret = WEBHOOK_SECRET, toleranceSeconds = TOLERANCE_SECONDS } = {}
) {
  if (!secret) return false;
  const parts = Object.fromEntries(
    String(header || "")
      .split(",")
      .map((kv) => kv.split("="))
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;

  // Reject stale (or absurdly future-dated) signatures before spending a hash.
  const ts = Number(t);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(now / 1000 - ts) > toleranceSeconds) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${rawBody}`)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
  } catch {
    return false;
  }
}

// Stripe delivers the same event more than once (retries, and anyone replaying a
// captured delivery). Granting a credit pack twice is free money, so every
// mutation is recorded against the user and skipped if already applied.
const MAX_SEEN_EVENTS = 50;

function alreadyApplied(user, eventId) {
  if (!eventId) return false;
  return Array.isArray(user.processedEvents) && user.processedEvents.includes(eventId);
}

function markApplied(user, eventId) {
  if (!eventId) return;
  const seen = Array.isArray(user.processedEvents) ? user.processedEvents : [];
  user.processedEvents = [...seen, eventId].slice(-MAX_SEEN_EVENTS);
}

// Process a webhook. `rawBody` must be the unparsed request body (Buffer/string).
export async function handleWebhook(rawBody, sigHeader) {
  if (!verifySignature(rawBody.toString(), sigHeader)) {
    return { ok: false, status: 400, error: "bad signature" };
  }
  let event;
  try {
    event = JSON.parse(rawBody.toString());
  } catch {
    return { ok: false, status: 400, error: "bad payload" };
  }

  if (
    event.type === "checkout.session.completed" ||
    event.type === "customer.subscription.created"
  ) {
    const obj = event.data?.object || {};
    const userId = obj.client_reference_id || obj.metadata?.userId;
    const user = userId ? await getUserById(userId) : null;
    if (user && alreadyApplied(user, event.id)) return { ok: true, status: 200, duplicate: true };

    // One-time credit pack — grant credits instead of changing plan.
    if (user && obj.metadata?.type === "pack") {
      const credits = Number(obj.metadata?.credits) || 0;
      if (obj.customer) user.stripeCustomer = obj.customer;
      markApplied(user, event.id);
      await grantCredits(user, credits);
    } else if (user && obj.metadata?.plan) {
      user.stripeCustomer = obj.customer || user.stripeCustomer;
      markApplied(user, event.id);
      await setPlan(user, obj.metadata.plan); // setPlan persists the full user record
    }
  }
  if (event.type === "customer.subscription.deleted") {
    const user = await getUserByStripeCustomer(event.data?.object?.customer);
    if (user) {
      if (alreadyApplied(user, event.id)) return { ok: true, status: 200, duplicate: true };
      markApplied(user, event.id);
      await setPlan(user, "free");
    }
  }
  return { ok: true, status: 200 };
}
