// Anthropic integration for Reelmint.
// Exposes generateText() / generateJSON() plus a vision helper.
// If ANTHROPIC_API_KEY is absent the module runs in DEMO mode, where callers
// pass in a rich, topic-aware fallback (see demo.js) so the whole product is
// believable end-to-end without a key.

import Anthropic from "@anthropic-ai/sdk";
import { JSON_PREFILL } from "./prompts.js";

// Best-in-class defaults. A single flagship model handles reasoning + writing;
// vision uses the same family. Override per deployment via env.
const MODEL = process.env.AI_MODEL || "claude-opus-4-8";
const VISION_MODEL = process.env.AI_VISION_MODEL || MODEL;
const API_KEY = process.env.ANTHROPIC_API_KEY || "";

// Creative work wants a little warmth; structured extraction wants precision.
const CREATIVE_TEMP = clampTemp(process.env.AI_TEMPERATURE, 0.8);
const PRECISE_TEMP = clampTemp(process.env.AI_JSON_TEMPERATURE, 0.4);

export const aiEnabled = Boolean(API_KEY);

const client = aiEnabled ? new Anthropic({ apiKey: API_KEY }) : null;

export function aiStatus() {
  return { enabled: aiEnabled, model: aiEnabled ? MODEL : "demo" };
}

// Low-level text call. `content` may be a plain string or an array of content
// blocks (used for vision / document input).
export async function generateText({
  system,
  content,
  maxTokens = 4000,
  temperature = CREATIVE_TEMP,
  model = MODEL,
  demo = "",
}) {
  if (!aiEnabled) return demo;
  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: "user", content }],
  });
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

// Asks the model for JSON and parses it defensively (handles ```json fences,
// stray prose, and a leading assistant prefill). Falls back to `demo` if the
// key is absent or nothing parseable comes back — never throws on parse.
export async function generateJSON({
  system,
  content,
  maxTokens = 4000,
  temperature = PRECISE_TEMP,
  model = MODEL,
  demo,
}) {
  if (!aiEnabled) return typeof demo === "function" ? demo() : demo;
  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system: `${system}\n\nReturn ONLY valid minified JSON. No markdown, no commentary.`,
    messages: [
      { role: "user", content },
      // Prefill the assistant turn with "{" so the model commits to JSON.
      { role: "assistant", content: JSON_PREFILL },
    ],
  });
  const raw = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return parseLooseJSON(JSON_PREFILL + raw, typeof demo === "function" ? demo() : demo);
}

// Vision: extract & repurpose content from an uploaded image.
export async function visionExtract({ base64, mediaType, instruction, demo = "" }) {
  if (!aiEnabled) return demo;
  const content = [
    { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
    { type: "text", text: instruction },
  ];
  return generateText({
    system:
      "You are Reelmint's scan-and-repurpose engine. Read everything in the image accurately, then do exactly what the user asks.",
    content,
    maxTokens: 4000,
    model: VISION_MODEL,
    demo,
  });
}

// Models wrap JSON in code fences, prefix it with prose, or truncate it. This is
// the boundary every structured route depends on, so it never throws — it falls
// back to the route's demo content instead. Exported for testing.
export function parseLooseJSON(raw, fallback) {
  if (!raw) return fallback;
  let text = String(raw).trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (start !== -1 && end !== -1) text = text.slice(start, end + 1);
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function clampTemp(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : dflt;
}
