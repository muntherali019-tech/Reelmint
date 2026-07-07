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
} from "./auth.js";
import { stripeEnabled, createCheckout, handleWebhook } from "./billing.js";
import { generateImage, imageProvider } from "./images.js";
import { initStore, backend } from "./store.js";

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

// ---------- meta ----------
app.get("/api/health", (_req, res) => res.json({ ok: true, ...aiStatus() }));

app.get("/api/config", (req, res) => {
  res.json({
    ...aiStatus(),
    watermark: !NO_WATERMARK,
    plans: PLANS,
    stripe: stripeEnabled,
    imageProvider,
    user: publicUser(req.user),
  });
});

// ---------- accounts ----------
app.post("/api/auth/signup", async (req, res) => {
  try {
    res.json(await signup(req.body?.email, req.body?.password));
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

  const credit = await spendCredit(req.user);
  if (!credit.ok)
    return res.status(402).json({ error: "out_of_credits", user: publicUser(req.user) });

  const sceneCount = Math.max(3, Math.min(8, Math.round(durationSec / 6)));
  const system =
    "You are Reelmint's director — you turn a topic into a punchy, platform-native video storyboard. " +
    "Write a scroll-stopping hook, then scene-by-scene voiceover + on-screen captions, plus an image prompt for each scene. " +
    "Voiceover is spoken aloud (natural, concise). Captions are short on-screen text (max ~8 words).";

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
      system,
      content: `Topic: ${topic}
Platform: ${platform}
Tone: ${tone}
Target length: ${durationSec}s (${format})
Make exactly ${sceneCount} scenes.
${schema}`,
      maxTokens: 3000,
      demo: demoStoryboard(topic, sceneCount),
    });
  } catch (e) {
    // Generation failed after the credit was spent — refund it.
    await refundCredit(req.user);
    return res
      .status(502)
      .json({ error: "generation_failed", user: publicUser(req.user) });
  }

  res.json({ ...decorateStoryboard(data), user: publicUser(req.user) });
}));

// ---------- AI editor assistant (voice or text instructions) ----------
app.post("/api/assistant", wrap(async (req, res) => {
  const { instruction = "", storyboard = null } = req.body || {};
  if (!instruction.trim())
    return res.status(400).json({ error: "instruction is required" });

  const system =
    "You are Reelmint's AI editor. The user gives a verbal or typed instruction to change their video storyboard. " +
    "Apply the change and return the FULL updated storyboard plus a one-sentence friendly reply describing what you changed.";

  const data = await generateJSON({
    system,
    content: `Current storyboard JSON:
${JSON.stringify(storyboard) || "none yet"}

User instruction: ${instruction}

Return JSON: { "reply": string, "storyboard": { "title": string, "hook": string, "scenes": [{"caption": string, "voiceover": string, "imagePrompt": string}], "hashtags": [string], "description": string } }`,
    maxTokens: 3000,
    demo: {
      reply: aiEnabled
        ? "Updated."
        : "Demo mode: add your ANTHROPIC_API_KEY for real edits.",
      storyboard: storyboard || demoStoryboard(instruction, 4),
    },
  });

  if (data.storyboard) data.storyboard = decorateStoryboard(data.storyboard);
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
    system:
      "You are Reelmint's graphic designer. Turn the prompt into a striking poster design spec. " +
      "Pick a cohesive palette and write a short punchy headline + sub-line.",
    content: `Prompt: ${prompt}
Style: ${style}
Return JSON: { "headline": string, "subline": string, "palette": {"bg": string, "accent": string, "text": string}, "layout": "center" | "lower" | "split" }`,
    maxTokens: 700,
    demo: {
      headline: prompt.slice(0, 40),
      subline: "Made with Reelmint",
      palette: PALETTES[0],
      layout: "center",
    },
  });
  res.json({ type: "design", design });
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
    const text = await visionExtract({ base64, mediaType, instruction });
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
    system:
      "You are Reelmint's clip finder. From a long transcript, find the most viral short-clip moments.",
    content: `Transcript:
${transcript.slice(0, 12000)}

Return JSON: { "clips": [{ "title": string, "hook": string, "quote": string, "hashtags": [string] }] } with ${count} clips.`,
    maxTokens: 2500,
    demo: { clips: [{ title: "Demo clip", hook: "Add your API key", quote: transcript.slice(0, 80), hashtags: ["#reelmint"] }] },
  });
  res.json(data);
}));

// ---------- copy / captions ----------
app.post("/api/captions", wrap(async (req, res) => {
  const { topic = "", platform = "instagram", count = 6 } = req.body || {};
  if (!topic.trim()) return res.status(400).json({ error: "topic is required" });
  const text = await generateText({
    system:
      "You are Reelmint's copywriter. Write scroll-stopping captions with relevant hashtags and a strong CTA.",
    content: `Write ${count} ${platform} captions about: ${topic}. Number them.`,
    maxTokens: 1200,
  });
  res.json({ text });
}));

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
];

function decorateStoryboard(sb) {
  if (!sb || !Array.isArray(sb.scenes)) return demoStoryboard("your idea", 4);
  sb.scenes = sb.scenes.map((s, i) => ({
    caption: s.caption || "",
    voiceover: s.voiceover || s.caption || "",
    imagePrompt: s.imagePrompt || s.caption || sb.title || "",
    palette: PALETTES[i % PALETTES.length],
  }));
  sb.hashtags = Array.isArray(sb.hashtags) ? sb.hashtags : [];
  return sb;
}

function demoStoryboard(topic, sceneCount) {
  const t = (topic || "your big idea").trim();
  const scenes = Array.from({ length: sceneCount }, (_, i) => ({
    caption: i === 0 ? `Stop scrolling 👀` : `Point ${i}: why ${t} wins`,
    voiceover:
      i === 0
        ? `Here's what nobody tells you about ${t}.`
        : `Reason number ${i}: ${t} changes everything once you try it.`,
    imagePrompt: `cinematic poster about ${t}, scene ${i + 1}`,
  }));
  return {
    title: `${t} in ${sceneCount * 6}s`,
    hook: `The truth about ${t}`,
    scenes,
    hashtags: ["#reelmint", "#ai", "#" + t.replace(/\s+/g, "").toLowerCase()],
    description: `A short video about ${t}, minted with Reelmint.`,
  };
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
