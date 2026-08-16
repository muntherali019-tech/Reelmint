// Reelmint's single source of truth for everything that's for sale.
//
// Two revenue lines live here:
//   1. PLANS        — recurring subscriptions (Free / Creator / Studio)
//   2. CREDIT_PACKS — one-time credit top-ups (pay-as-you-go, no subscription)
//
// Every paid SKU carries `amount` (in `CURRENCY` minor units) so a Checkout
// session can be built from inline `price_data` — meaning the server can charge
// with nothing configured but `STRIPE_SECRET_KEY`. A dashboard Price ID may
// still be supplied per SKU (`stripePrice`) to override the inline amount; see
// `buildLineItem` in billing.js.
//
// `price`/`period` are display strings for the storefront and must stay in sync
// with `amount` — products.test.js asserts that they do.

export const CURRENCY = "usd";

// ---------------- Subscriptions ----------------
export const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "forever",
    amount: 0,
    credits: "5 videos / mo",
    features: [
      "720p exports",
      "Reelmint watermark",
      "AI editor (basic)",
      "Smart Slide images",
      "Trend radar",
    ],
    cta: "Start free",
  },
  {
    id: "creator",
    name: "Creator",
    price: "$19",
    period: "/mo",
    amount: 1900,
    interval: "month",
    credits: "100 videos / mo",
    features: [
      "1080p exports",
      "No watermark",
      "Voice AI editor",
      "Brand kit",
      "Campaign studio",
      "Scan & repurpose",
    ],
    cta: "Go Creator",
    popular: true,
    stripePrice: process.env.STRIPE_PRICE_CREATOR || "",
  },
  {
    id: "studio",
    name: "Studio",
    price: "$49",
    period: "/mo",
    amount: 4900,
    interval: "month",
    credits: "Unlimited videos",
    features: [
      "4K-ready exports",
      "Team seats",
      "API access",
      "Priority rendering",
      "Custom voices",
      "Everything in Creator",
    ],
    cta: "Go Studio",
    stripePrice: process.env.STRIPE_PRICE_STUDIO || "",
  },
];

// Monthly credit allowance per plan (Infinity = unlimited). Kept here so auth.js
// and the storefront can never drift apart — auth.js re-exports this.
export const PLAN_CREDITS = {
  free: 5,
  creator: 100,
  studio: Infinity,
};

// Plans a user can actually pay for (Free is not a checkout).
export const PAID_PLANS = PLANS.filter((p) => p.amount > 0);

export function findPlan(id) {
  return PLANS.find((p) => p.id === id) || null;
}

// ---------------- One-time credit packs ----------------
// Buy credits outright — no subscription required. The impulse-purchase path:
// it converts occasional users, and catches paid users who burn through their
// monthly allowance mid-campaign.
export const CREDIT_PACKS = [
  {
    id: "pack50",
    label: "50 credits",
    credits: 50,
    amount: 900,
    price: "$9",
    blurb: "50 extra render credits",
    stripePrice: process.env.STRIPE_PRICE_PACK50 || "",
  },
  {
    id: "pack200",
    label: "200 credits",
    credits: 200,
    amount: 2900,
    price: "$29",
    best: true,
    blurb: "200 credits · best value",
    stripePrice: process.env.STRIPE_PRICE_PACK200 || "",
  },
  {
    id: "pack500",
    label: "500 credits",
    credits: 500,
    amount: 5900,
    price: "$59",
    blurb: "500 credits for a big campaign",
    stripePrice: process.env.STRIPE_PRICE_PACK500 || "",
  },
];

export function findPack(id) {
  return CREDIT_PACKS.find((p) => p.id === id) || null;
}

// Flat lookup so a webhook / purchase route can resolve any SKU by id.
export const PRODUCTS_BY_ID = Object.fromEntries(
  [...PAID_PLANS, ...CREDIT_PACKS].map((p) => [p.id, p])
);

export function findProduct(id) {
  return PRODUCTS_BY_ID[id] || null;
}

// What the storefront needs, minus the server-only `stripePrice` field.
const strip = ({ stripePrice, ...rest }) => rest;

export function catalog() {
  return {
    plans: PLANS.map(strip),
    creditPacks: CREDIT_PACKS.map(strip),
  };
}
