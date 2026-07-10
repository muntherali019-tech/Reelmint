// Stripe Checkout + webhook handling via the Stripe REST API (no SDK needed).
// Gracefully no-ops when Stripe env vars are absent.
import crypto from "node:crypto";
import { getUserById, getUserByStripeCustomer } from "./store.js";
import { setPlan, addCredits, unlockTemplate, grantAddOn } from "./auth.js";
import { findProduct } from "./products.js";

const SECRET = process.env.STRIPE_SECRET_KEY || "";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const PRICES = {
  creator: process.env.STRIPE_PRICE_CREATOR || "",
  studio: process.env.STRIPE_PRICE_STUDIO || "",
  agency: process.env.STRIPE_PRICE_AGENCY || "",
};

export const stripeEnabled = Boolean(SECRET && (PRICES.creator || PRICES.studio || PRICES.agency));

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
  const price = PRICES[plan];
  if (!price) throw new Error("Unknown plan");
  const session = await stripe("checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    client_reference_id: user.id,
    customer_email: user.email,
    "metadata[plan]": plan,
    "metadata[userId]": user.id,
    success_url: `${origin}/?upgraded=${plan}`,
    cancel_url: `${origin}/?canceled=1`,
  });
  return session.url;
}

// Create a ONE-TIME payment Checkout session for a credit pack, add-on or
// marketplace template. Builds the line item inline (price_data) so no Stripe
// dashboard Price is required — the catalog in products.js is the source of truth.
export async function createProductCheckout({ user, productId, origin }) {
  if (!stripeEnabled) throw new Error("Stripe is not configured");
  const product = findProduct(productId);
  if (!product) throw new Error("Unknown product");
  const session = await stripe("checkout/sessions", {
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(product.amount),
    "line_items[0][price_data][product_data][name]": `Reelmint — ${product.name}`,
    client_reference_id: user.id,
    customer_email: user.email,
    "metadata[userId]": user.id,
    "metadata[productId]": product.id,
    success_url: `${origin}/?purchased=${encodeURIComponent(product.id)}`,
    cancel_url: `${origin}/?canceled=1`,
  });
  return session.url;
}

// Apply a completed one-time purchase to a user's account. Also called directly
// in demo mode (no Stripe) so the storefront is fully clickable end-to-end.
export async function fulfillProduct(user, productId) {
  const product = findProduct(productId);
  if (!user || !product) return { ok: false, error: "unknown product" };
  if (product.credits) {
    await addCredits(user, product.credits); // credit pack
  } else if (product.creatorShare != null) {
    await unlockTemplate(user, product.id); // marketplace template
  } else {
    await grantAddOn(user, product.id); // add-on
  }
  return { ok: true, product: { id: product.id, name: product.name } };
}

// Verify Stripe's webhook signature against the raw request body.
function verifySignature(rawBody, header) {
  if (!WEBHOOK_SECRET) return false;
  const parts = Object.fromEntries(
    String(header || "")
      .split(",")
      .map((kv) => kv.split("="))
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  const expected = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(`${t}.${rawBody}`)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
  } catch {
    return false;
  }
}

// Process a webhook. `rawBody` must be the unparsed request body (Buffer/string).
export async function handleWebhook(rawBody, sigHeader) {
  if (!verifySignature(rawBody.toString(), sigHeader)) {
    return { ok: false, status: 400, error: "bad signature" };
  }
  const event = JSON.parse(rawBody.toString());
  if (
    event.type === "checkout.session.completed" ||
    event.type === "customer.subscription.created"
  ) {
    const obj = event.data.object;
    const userId = obj.client_reference_id || obj.metadata?.userId;
    const plan = obj.metadata?.plan;
    const productId = obj.metadata?.productId;
    const user = userId ? await getUserById(userId) : null;
    if (user && plan) {
      user.stripeCustomer = obj.customer || user.stripeCustomer;
      await setPlan(user, plan); // setPlan persists the full user record
    } else if (user && productId) {
      // One-time purchase (credit pack, add-on or marketplace template).
      await fulfillProduct(user, productId);
    }
  }
  if (event.type === "customer.subscription.deleted") {
    const user = await getUserByStripeCustomer(event.data.object.customer);
    if (user) await setPlan(user, "free");
  }
  return { ok: true, status: 200 };
}
