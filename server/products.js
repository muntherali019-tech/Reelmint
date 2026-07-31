// Reelmint's single source of truth for everything that's for sale.
//
// Four revenue lines live here:
//   1. plans        — recurring subscriptions (Free → Agency)
//   2. creditPacks  — one-time credit top-ups (pay-as-you-go, no subscription)
//   3. addOns       — one-time upgrades you bolt onto any plan
//   4. templates    — the Template Marketplace (premium prompt/brand packs)
//
// Prices are display strings; the real charge amount lives in `amount` (USD
// cents) so the one-time Stripe Checkout can be built without a dashboard Price.

// ---------------- Subscriptions ----------------
export const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "forever",
    credits: "5 videos / mo",
    features: ["720p exports", "Reelmint watermark", "AI editor (basic)", "Smart Slide images"],
    cta: "Start free",
  },
  {
    id: "creator",
    name: "Creator",
    price: "$19",
    period: "/mo",
    credits: "100 videos / mo",
    features: ["1080p exports", "No watermark", "Voice AI editor", "Brand kit", "Scan & repurpose"],
    cta: "Go Creator",
    popular: true,
  },
  {
    id: "studio",
    name: "Studio",
    price: "$49",
    period: "/mo",
    credits: "Unlimited videos",
    features: ["4K-ready exports", "Team seats", "API access", "Priority rendering", "Custom voices"],
    cta: "Go Studio",
  },
  {
    id: "agency",
    name: "Agency",
    price: "$149",
    period: "/mo",
    credits: "Unlimited + client seats",
    features: [
      "Everything in Studio",
      "10 client workspaces",
      "White-label exports",
      "Bulk generation queue",
      "Dedicated support",
    ],
    cta: "Go Agency",
  },
];

// Monthly credit allowance per plan (Infinity = unlimited). Kept here so auth.js
// and the catalog can never drift apart.
export const PLAN_CREDITS = {
  free: 5,
  creator: 100,
  studio: Infinity,
  agency: Infinity,
};

// ---------------- One-time credit packs (Revenue feature #1) ----------------
// Buy credits outright — no subscription required. Great for occasional users
// and for paid users who blow through their monthly allowance.
export const CREDIT_PACKS = [
  { id: "pack_starter", name: "Starter pack", credits: 50, amount: 900, price: "$9", blurb: "50 extra render credits" },
  { id: "pack_pro", name: "Pro pack", credits: 200, amount: 2900, price: "$29", blurb: "200 credits · best value", popular: true },
  { id: "pack_bulk", name: "Bulk pack", credits: 500, amount: 5900, price: "$59", blurb: "500 credits for a big campaign" },
];

// ---------------- One-time add-ons ----------------
export const ADDONS = [
  { id: "addon_seat", name: "Extra team seat", amount: 900, price: "$9", period: "/mo", blurb: "Add a collaborator to your workspace" },
  { id: "addon_brandkit", name: "Brand kit unlock", amount: 1900, price: "$19", blurb: "Lock in fonts, colors & logo across every export" },
  { id: "addon_priority", name: "Priority rendering", amount: 1500, price: "$15", period: "/mo", blurb: "Skip the queue on busy days" },
];

// ---------------- Template Marketplace (Revenue feature #2) ----------------
// Premium, ready-to-mint content packs. One-time purchase unlocks the pack for
// the buyer's account. `creatorShare` models a marketplace split so third-party
// creators could sell here too (platform keeps the remainder).
export const TEMPLATES = [
  {
    id: "tpl_viral_hooks",
    name: "50 Viral Hooks Pack",
    category: "Short-form",
    amount: 1200,
    price: "$12",
    creatorShare: 0.7,
    blurb: "50 battle-tested opening lines that stop the scroll.",
    tags: ["TikTok", "Reels", "Shorts"],
  },
  {
    id: "tpl_product_launch",
    name: "Product Launch Kit",
    category: "E-commerce",
    amount: 2400,
    price: "$24",
    creatorShare: 0.7,
    blurb: "Announcement, demo, testimonial & sale storyboards.",
    tags: ["Ads", "DTC", "Launch"],
    popular: true,
  },
  {
    id: "tpl_faceless",
    name: "Faceless Channel Bundle",
    category: "Automation",
    amount: 3900,
    price: "$39",
    creatorShare: 0.7,
    blurb: "30 days of faceless video scripts + voiceover styles.",
    tags: ["YouTube", "Passive", "Bulk"],
  },
  {
    id: "tpl_real_estate",
    name: "Real Estate Reels",
    category: "Local biz",
    amount: 1900,
    price: "$19",
    creatorShare: 0.7,
    blurb: "Listing tours, market updates & agent intros.",
    tags: ["Realtor", "Local", "Tour"],
  },
];

// Flat lookup so a webhook / purchase route can resolve any SKU by id.
const ALL = [...CREDIT_PACKS, ...ADDONS, ...TEMPLATES];
export const PRODUCTS_BY_ID = Object.fromEntries(ALL.map((p) => [p.id, p]));

export function findProduct(id) {
  return PRODUCTS_BY_ID[id] || null;
}

// Everything the storefront needs in one payload.
export function catalog() {
  return {
    plans: PLANS,
    creditPacks: CREDIT_PACKS,
    addOns: ADDONS,
    templates: TEMPLATES,
  };
}
