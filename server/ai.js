// Anthropic integration for Reelmint.
// Exposes generateText() and generateJSON() plus a vision helper.
// If ANTHROPIC_API_KEY is absent the module runs in DEMO mode so the whole
// product is still clickable end-to-end without a key.

import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.AI_MODEL || "claude-opus-4-8";
const API_KEY = process.env.ANTHROPIC_API_KEY || "";

export const aiEnabled = Boolean(API_KEY);

const client = aiEnabled ? new Anthropic({ apiKey: API_KEY }) : null;

export function aiStatus() {
  return { enabled: aiEnabled, model: aiEnabled ? MODEL : "demo" };
}

// Low-level text call. `content` may be a plain string or an array of
// content blocks (used for vision / document input).
export async function generateText({ system, content, maxTokens = 4000 }) {
  if (!aiEnabled) {
    return demoText(typeof content === "string" ? content : "");
  }
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content }],
  });
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

// Asks the model for JSON and parses it defensively (handles ```json fences
// and stray prose). Throws only if nothing parseable comes back.
export async function generateJSON({ system, content, maxTokens = 4000, demo }) {
  if (!aiEnabled) return demo;
  const raw = await generateText({
    system: `${system}\n\nReturn ONLY valid minified JSON. No markdown, no commentary.`,
    content,
    maxTokens,
  });
  return parseLooseJSON(raw, demo);
}

// Vision: extract & repurpose content from an uploaded image.
export async function visionExtract({ base64, mediaType, instruction }) {
  if (!aiEnabled) {
    return demoText("scanned image: " + instruction);
  }
  const content = [
    {
      type: "image",
      source: { type: "base64", media_type: mediaType, data: base64 },
    },
    { type: "text", text: instruction },
  ];
  return generateText({
    system:
      "You are Reelmint's scan-and-repurpose engine. Read everything in the image accurately, then do exactly what the user asks.",
    content,
    maxTokens: 4000,
  });
}

function parseLooseJSON(raw, fallback) {
  if (!raw) return fallback;
  let text = raw.trim();
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

// ---- DEMO MODE helpers (only used when no API key is set) ----
function demoText(seed) {
  return (
    "Demo mode is on — add your ANTHROPIC_API_KEY to unlock real AI.\n\n" +
    "Here's placeholder output so you can see the workflow end-to-end. " +
    (seed ? `You asked about: "${seed.slice(0, 120)}".` : "")
  );
}
