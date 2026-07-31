// Reelmint server — serves the web app and the AI API.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  aiStatus,
  aiEnabled,
  generateJSON,
  generateText,
  visionExtract,
} from "./ai.js";
import {
  signup,
  login,
  attachUser,
  publicUser,
  spendCredit,
  refundCredit,
  setBrandKit,
  isPremium,
} from "./auth.js";
import {
  stripeEnabled,
  creditPacksEnabled,
  createCheckout,
  createPackCheckout,
  handleWebhook,
  CREDIT_PACKS,
} from "./billing.js";
import { generateImage, imageProvider } from "./images.js";
import { initStore, backend } from "./store.js";
import { PROMPTS } from "./prompts.js";
import {
  demoStoryboard,
  demoAssistant,
  demoCaptions,
  demoScan,
  demoClips,
  demoDesign,
  demoCampaign,
  demoTrends,
  demoAds,
  demoThumbnails,
  demoArticle,
  demoCarousel,
} from "./demo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const app = express();
// Behind Render's proxy — trust it so req.protocol is https (used in checkout URLs).
app.set("trust proxy", 1);

// Wrap async handlers so a rejected promise becomes a clean 500 instead of a
// hung request (Express 4 does not catch async errors on its own).
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Stripe webhook needs the RAW body — mount it before the JSON parser.
app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const result = await handleWebhook(req.body, req.headers["stripe-signature"]);
    res.status(result.status).json({ received: result.ok });
  }
);

app.use(express.json({ limit: "20mb" }));
app.use(attachUser);
app.use(express.static(PUBLIC_DIR));

const NO_WATERMARK = process.env.REELMINT_NO_WATERMARK === "1";

const PALETTES = [
  { bg: "#0E1116", accent: "#5B8CFF", text: "#F4F6FB", muted: "#9AA4B2" },
  { bg: "#13070A", accent: "#FF5C7A", text: "#FFF1F3", muted: "#D9A6B0" },
  { bg: "#06120E", accent: "#36E0A0", text: "#EAFBF4", muted: "#9CC8B8" },
  { bg: "#120E06", accent: "#FFB23E", text: "#FFF6E8", muted: "#D8BD98" },
  { bg: "#0B0716", accent: "#A66BFF", text: "#F3EDFF", muted: "#B5A6D4" },
];

// Cost (in credits) of each paid action.
const COST = { script: 1, campaignPerPost: 1, trends: 1, ads: 1, thumbnails: 1, article: 2, carousel: 1 };

// ---------- meta ----------
app.get("/api/health", (_req, res) => res.json({ ok: true, ...aiStatus() }));

app.get("/api/config", (req, res) => {
  res.json({
    ...aiStatus(),
    watermark: !NO_WATERMARK,
    plans: PLANS,
    stripe: stripeEnabled,
    creditPacksEnabled,
    creditPacks: CREDIT_PACKS.map(({ id, label, credits, price, best }) => ({ id, label, credits, price, best })),
    imageProvider,
    user: publicUser(req.user),
  });
});

// ---------- accounts ----------
app.post("/api/auth/signup", async (req, res) => {
  try {
    res.json(await signup(req.body?.email, req.body?.password, req.body?.ref));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post("/api/auth/login", async (req, res) => {
  try {
    res.json(await login(req.body?.email, req.body?.password));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.get("/api/me", (req, res) => res.json({ user: publicUser(req.user) }));

// ---------- brand kit (premium revenue feature) ----------
app.get("/api/brandkit", (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Sign in first" });
  res.json({ brandKit: req.user.brandKit || null, premium: isPremium(req.user) });
});
app.post("/api/brandkit", wrap(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Sign in first" });
  try {
    const brandKit = await setBrandKit(req.user, req.body || {});
    res.json({ brandKit, user: publicUser(req.user) });
  } catch (e) {
    res.status(403).json({ error: e.message });
  }
}));

// ---------- billing ----------
app.post("/api/billing/checkout", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Sign in first" });
  if (!stripeEnabled)
    return res.status(400).json({ error: "Billing not configured on this server" });
  try {
    const origin = `${req.protocol}://${req.get("host")}`;
    const url = await createCheckout({ user: req.user, plan: req.body?.plan, origin });
    res.json({ url });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// One-time credit-pack purchase (à-la-carte revenue).
app.post("/api/billing/credits", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Sign in first" });
  if (!creditPacksEnabled)
    return res.status(400).json({ error: "Credit packs not configured on this server" });
  try {
    const origin = `${req.protocol}://${req.get("host")}`;
    const url = await createPackCheckout({ user: req.user, pack: req.body?.pack, origin });
    res.json({ url });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- storyboard / video script (costs 1 credit) ----------
app.post("/api/script", wrap(async (req, res) => {
  const {
    topic = "",
    platform = "tiktok",
    tone = "energetic",
    durationSec = 30,
    format = "short",
  } = req.body || {};
  if (!topic.trim()) return res.status(400).json({ error: "topic is required" });

  const credit = await spendCredit(req.user, COST.script);
  if (!credit.ok)
    return res.status(402).json({ error: "out_of_credits", user: publicUser(req.user) });

  const sceneCount = Math.max(3, Math.min(8, Math.round(durationSec / 6)));
  const brandVoice = req.user?.brandKit?.voice
    ? `\n\nMatch this brand voice: ${req.user.brandKit.voice}`
    : "";

  const schema = `JSON shape: {
  "title": string,
  "hook": string,
  "scenes": [{ "caption": string, "voiceover": string, "imagePrompt": string }],
  "hashtags": [string],
  "description": string
}`;

  let data;
  try {
    data = await generateJSON({
      system: PROMPTS.director(sceneCount) + brandVoice,
      content: `Topic: ${topic}
Platform: ${platform}
Tone: ${tone}
Target length: ${durationSec}s (${format})
Make exactly ${sceneCount} scenes.
${schema}`,
      maxTokens: 3000,
      demo: () => demoStoryboard(topic, sceneCount, { platform, tone }),
    });
  } catch (e) {
    // Generation failed after the credit was spent — refund it.
    await refundCredit(req.user, COST.script);
    return res
      .status(502)
      .json({ error: "generation_failed", user: publicUser(req.user) });
  }

  res.json({ ...decorateStoryboard(data, req.user), user: publicUser(req.user) });
}));

// ---------- AI editor assistant (voice or text instructions) ----------
app.post("/api/assistant", wrap(async (req, res) => {
  const { instruction = "", storyboard = null } = req.body || {};
  if (!instruction.trim())
    return res.status(400).json({ error: "instruction is required" });

  const data = await generateJSON({
    system: PROMPTS.editor,
    content: `Current storyboard JSON:
${JSON.stringify(storyboard) || "none yet"}

User instruction: ${instruction}

Return JSON: { "reply": string, "storyboard": { "title": string, "hook": string, "scenes": [{"caption": string, "voiceover": string, "imagePrompt": string}], "hashtags": [string], "description": string } }`,
    maxTokens: 3000,
    demo: () => demoAssistant(instruction, storyboard),
  });

  if (data.storyboard) data.storyboard = decorateStoryboard(data.storyboard, req.user);
  res.json(data);
}));

// ---------- picture / poster ----------
app.post("/api/image", wrap(async (req, res) => {
  const { prompt = "", style = "bold" } = req.body || {};
  if (!prompt.trim()) return res.status(400).json({ error: "prompt is required" });

  // Try a real image provider first (photoreal).
  const img = await generateImage({ prompt: `${prompt}. Style: ${style}.` });
  if (img && (img.url || img.b64))
    return res.json({ type: "image", url: img.url, b64: img.b64 });

  // Otherwise generate a "Smart Slide" design spec the browser renders to PNG.
  const design = await generateJSON({
    system: PROMPTS.designer,
    content: `Prompt: ${prompt}
Style: ${style}
Return JSON: { "headline": string, "subline": string, "palette": {"bg": string, "accent": string, "text": string}, "layout": "center" | "lower" | "split" }`,
    maxTokens: 700,
    demo: () => demoDesign(prompt, style),
  });
  res.json({ type: "design", design: applyBrandPalette(design, req.user) });
}));

// ---------- scan & upload (vision) ----------
app.post("/api/scan", async (req, res) => {
  const {
    base64 = "",
    mediaType = "image/png",
    instruction = "Extract the text and rewrite it as 3 short social captions.",
  } = req.body || {};
  if (!base64) return res.status(400).json({ error: "base64 image is required" });
  try {
    const text = await visionExtract({
      base64,
      mediaType,
      instruction: `${PROMPTS.scan}\n\n${instruction}`,
      demo: demoScan(instruction),
    });
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: "scan failed", detail: String(e?.message || e) });
  }
});

// ---------- repurpose long-form into clips ----------
app.post("/api/repurpose", wrap(async (req, res) => {
  const { transcript = "", count = 4 } = req.body || {};
  if (!transcript.trim())
    return res.status(400).json({ error: "transcript is required" });
  const data = await generateJSON({
    system: PROMPTS.clipfinder,
    content: `Transcript:
${transcript.slice(0, 12000)}

Return JSON: { "clips": [{ "title": string, "hook": string, "quote": string, "hashtags": [string] }] } with ${count} clips.`,
    maxTokens: 2500,
    demo: () => demoClips(transcript, count),
  });
  res.json(data);
}));

// ---------- copy / captions ----------
app.post("/api/captions", wrap(async (req, res) => {
  const { topic = "", platform = "instagram", count = 6 } = req.body || {};
  if (!topic.trim()) return res.status(400).json({ error: "topic is required" });
  const text = await generateText({
    system: PROMPTS.copywriter(platform),
    content: `Write ${count} ${platform} captions about: ${topic}. Number them.`,
    maxTokens: 1200,
    demo: demoCaptions(topic, platform, count),
  });
  res.json({ text });
}));

// ---------- NEW: campaign / content series studio (premium, credit-costed) ----------
app.post("/api/campaign", wrap(async (req, res) => {
  const { theme = "", count = 7, platform = "tiktok" } = req.body || {};
  if (!theme.trim()) return res.status(400).json({ error: "theme is required" });
  if (!req.user) return res.status(401).json({ error: "Sign in to build a campaign" });
  if (!isPremium(req.user))
    return res.status(403).json({ error: "premium_required", user: publicUser(req.user) });

  const n = Math.max(3, Math.min(14, Number(count) || 7));
  const cost = Math.min(n, n * COST.campaignPerPost);
  const credit = await spendCredit(req.user, cost);
  if (!credit.ok)
    return res.status(402).json({ error: "out_of_credits", user: publicUser(req.user) });

  let data;
  try {
    data = await generateJSON({
      system: PROMPTS.strategist(n, platform),
      content: `Theme: ${theme}
Platform: ${platform}
Posts: ${n}
Return JSON: { "name": string, "bigIdea": string, "posts": [{ "day": number, "angle": string, "title": string, "hook": string, "format": string, "bestTime": string, "hashtags": [string] }] } with exactly ${n} posts.`,
      maxTokens: 4000,
      demo: () => demoCampaign(theme, n, { platform }),
    });
  } catch (e) {
    await refundCredit(req.user, cost);
    return res.status(502).json({ error: "generation_failed", user: publicUser(req.user) });
  }
  res.json({ ...data, cost, user: publicUser(req.user) });
}));

// ---------- NEW: trend & hashtag / SEO optimizer (credit-costed) ----------
app.post("/api/trends", wrap(async (req, res) => {
  const { topic = "", platform = "tiktok" } = req.body || {};
  if (!topic.trim()) return res.status(400).json({ error: "topic is required" });

  const credit = await spendCredit(req.user, COST.trends);
  if (!credit.ok)
    return res.status(402).json({ error: "out_of_credits", user: publicUser(req.user) });

  let data;
  try {
    data = await generateJSON({
      system: PROMPTS.trendscout,
      content: `Topic/idea: ${topic}
Platform: ${platform}
Return JSON: {
  "topic": string, "platform": string,
  "hashtags": { "broad": [{"tag": string, "reach": string, "note": string}], "mid": [...same...], "niche": [...same...] },
  "bestTimes": [{"window": string, "why": string}],
  "hookAngles": [string],
  "hookScore": {"score": number, "grade": string, "tip": string},
  "ridingTrend": string
}`,
      maxTokens: 2000,
      demo: () => demoTrends(topic, platform),
    });
  } catch (e) {
    await refundCredit(req.user, COST.trends);
    return res.status(502).json({ error: "generation_failed", user: publicUser(req.user) });
  }
  res.json({ ...data, user: publicUser(req.user) });
}));

// ---------- NEW: Ad Studio — paid social ad copy (premium, credit-costed) ----
app.post("/api/ads", wrap(async (req, res) => {
  const { product = "", platform = "meta", goal = "conversions" } = req.body || {};
  if (!product.trim()) return res.status(400).json({ error: "product is required" });
  if (!req.user) return res.status(401).json({ error: "Sign in to use Ad Studio" });
  if (!isPremium(req.user))
    return res.status(403).json({ error: "premium_required", user: publicUser(req.user) });

  const credit = await spendCredit(req.user, COST.ads);
  if (!credit.ok)
    return res.status(402).json({ error: "out_of_credits", user: publicUser(req.user) });

  let data;
  try {
    data = await generateJSON({
      system: PROMPTS.adsmith(platform, goal),
      content: `Product / offer: ${product}
Platform: ${platform}
Goal: ${goal}
Return JSON: { "audience": string, "variations": [{ "angle": string, "primaryText": string, "headline": string, "description": string, "cta": string }], "tip": string } with 5 variations.`,
      maxTokens: 2500,
      demo: () => demoAds(product, platform, goal),
    });
  } catch (e) {
    await refundCredit(req.user, COST.ads);
    return res.status(502).json({ error: "generation_failed", user: publicUser(req.user) });
  }
  res.json({ ...data, user: publicUser(req.user) });
}));

// ---------- NEW: Thumbnail & Title Lab — CTR A/B concepts (credit-costed) ----
app.post("/api/thumbnails", wrap(async (req, res) => {
  const { topic = "", platform = "youtube" } = req.body || {};
  if (!topic.trim()) return res.status(400).json({ error: "topic is required" });

  const credit = await spendCredit(req.user, COST.thumbnails);
  if (!credit.ok)
    return res.status(402).json({ error: "out_of_credits", user: publicUser(req.user) });

  let data;
  try {
    data = await generateJSON({
      system: PROMPTS.thumbnailer(platform),
      content: `Topic: ${topic}
Platform: ${platform}
Return JSON: { "topic": string, "platform": string, "concepts": [{ "title": string, "overlay": string, "visual": string, "emotion": string, "clickScore": number }], "winner": number } with 4 concepts ranked strongest first.`,
      maxTokens: 1800,
      demo: () => demoThumbnails(topic, platform),
    });
  } catch (e) {
    await refundCredit(req.user, COST.thumbnails);
    return res.status(502).json({ error: "generation_failed", user: publicUser(req.user) });
  }
  res.json({ ...data, user: publicUser(req.user) });
}));

// ---------- NEW: SEO Blog & Newsletter writer (premium, credit-costed) ----
app.post("/api/article", wrap(async (req, res) => {
  const { topic = "", keywords = "" } = req.body || {};
  if (!topic.trim()) return res.status(400).json({ error: "topic is required" });
  if (!req.user) return res.status(401).json({ error: "Sign in to use the SEO Writer" });
  if (!isPremium(req.user))
    return res.status(403).json({ error: "premium_required", user: publicUser(req.user) });

  const credit = await spendCredit(req.user, COST.article);
  if (!credit.ok)
    return res.status(402).json({ error: "out_of_credits", user: publicUser(req.user) });

  let data;
  try {
    data = await generateJSON({
      system: PROMPTS.seowriter,
      content: `Topic: ${topic}
Target keyword(s): ${keywords || topic}
Return JSON: { "metaTitle": string, "metaDescription": string, "slug": string, "readTime": string, "headings": [string], "body": string, "faq": [{ "q": string, "a": string }] }. The body is a full Markdown article.`,
      maxTokens: 3500,
      demo: () => demoArticle(topic, keywords),
    });
  } catch (e) {
    await refundCredit(req.user, COST.article);
    return res.status(502).json({ error: "generation_failed", user: publicUser(req.user) });
  }
  res.json({ ...data, cost: COST.article, user: publicUser(req.user) });
}));

// ---------- NEW: Carousel Maker — swipeable multi-slide posts (credit-costed) ----
app.post("/api/carousel", wrap(async (req, res) => {
  const { topic = "", platform = "instagram", slides = 6 } = req.body || {};
  if (!topic.trim()) return res.status(400).json({ error: "topic is required" });

  const credit = await spendCredit(req.user, COST.carousel);
  if (!credit.ok)
    return res.status(402).json({ error: "out_of_credits", user: publicUser(req.user) });

  const n = Math.max(3, Math.min(10, Number(slides) || 6));
  let data;
  try {
    data = await generateJSON({
      system: PROMPTS.carouselist(platform),
      content: `Topic: ${topic}
Platform: ${platform}
Slides: ${n}
Return JSON: { "title": string, "slides": [{ "headline": string, "body": string }], "caption": string, "hashtags": [string] } with exactly ${n} slides.`,
      maxTokens: 2200,
      demo: () => demoCarousel(topic, platform, n),
    });
  } catch (e) {
    await refundCredit(req.user, COST.carousel);
    return res.status(502).json({ error: "generation_failed", user: publicUser(req.user) });
  }
  res.json({ ...data, user: publicUser(req.user) });
}));

// Unknown API routes should answer with a JSON 404 rather than falling through
// to the SPA shell below (which would hand an API client an HTML page).
app.all("/api/*", (_req, res) => res.status(404).json({ error: "not_found" }));

// SPA fallback.
app.get("*", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

// Global error handler — anything a wrapped route throws lands here.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err?.message || err);
  if (res.headersSent) return;
  res.status(500).json({ error: "server_error" });
});

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "forever",
    credits: "5 videos / mo",
    features: ["720p exports", "Reelmint watermark", "AI editor (basic)", "Smart Slide images", "Trend radar"],
    cta: "Start free",
  },
  {
    id: "creator",
    name: "Creator",
    price: "$19",
    period: "/mo",
    credits: "100 videos / mo",
    features: ["1080p exports", "No watermark", "Voice AI editor", "Brand kit", "Campaign studio", "Scan & repurpose"],
    cta: "Go Creator",
    popular: true,
  },
  {
    id: "studio",
    name: "Studio",
    price: "$49",
    period: "/mo",
    credits: "Unlimited videos",
    features: ["4K-ready exports", "Team seats", "API access", "Priority rendering", "Custom voices", "Everything in Creator"],
    cta: "Go Studio",
  },
];

// Merge a user's brand palette (if any) into a design spec.
function applyBrandPalette(design, user) {
  const kit = user?.brandKit;
  if (!design || !kit) return design;
  design.palette = { bg: kit.bg, accent: kit.accent, text: kit.text };
  return design;
}

function decorateStoryboard(sb, user) {
  if (!sb || !Array.isArray(sb.scenes)) return demoStoryboard("your idea", 4);
  const brand = user?.brandKit;
  const brandPal = brand ? { bg: brand.bg, accent: brand.accent, text: brand.text, muted: brand.text } : null;
  sb.scenes = sb.scenes.map((s, i) => ({
    caption: s.caption || "",
    voiceover: s.voiceover || s.caption || "",
    imagePrompt: s.imagePrompt || s.caption || sb.title || "",
    palette: brandPal || PALETTES[i % PALETTES.length],
  }));
  sb.hashtags = Array.isArray(sb.hashtags) ? sb.hashtags : [];
  if (brand?.handle) sb.brand = { handle: brand.handle, name: brand.name };
  return sb;
}

const PORT = process.env.PORT || 3000;
initStore()
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        `Reelmint on http://localhost:${PORT}  (AI: ${aiEnabled ? "live" : "demo"}, store: ${backend}, images: ${imageProvider}, stripe: ${stripeEnabled ? "on" : "off"})`
      );
    });
  })
  .catch((e) => {
    console.error("Failed to initialize store:", e.message);
    process.exit(1);
  });
