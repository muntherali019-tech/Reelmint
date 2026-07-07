// Photoreal image generation. Two ways to wire a provider:
//   1) IMAGE_PROVIDER=openai + OPENAI_API_KEY  → OpenAI Images API (gpt-image-1)
//   2) IMAGE_API_URL (+ optional IMAGE_API_KEY) → any endpoint that takes
//      {prompt,width,height} and returns {url} or {b64}
// Returns { url } | { b64 } | null  (null → caller falls back to Smart Slides).

const PROVIDER = (process.env.IMAGE_PROVIDER || "").toLowerCase();
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.IMAGE_MODEL || "gpt-image-1";

export const imageProvider = PROVIDER === "openai" && OPENAI_KEY
  ? "openai"
  : process.env.IMAGE_API_URL
  ? "custom"
  : "smartslide";

export async function generateImage({ prompt, size = "1024x1024" }) {
  try {
    if (imageProvider === "openai") {
      const r = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          authorization: `Bearer ${OPENAI_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: OPENAI_MODEL, prompt, size, n: 1 }),
      });
      if (!r.ok) return null;
      const j = await r.json();
      const item = j?.data?.[0];
      if (item?.b64_json) return { b64: item.b64_json };
      if (item?.url) return { url: item.url };
      return null;
    }

    if (imageProvider === "custom") {
      const [w, h] = size.split("x").map(Number);
      const r = await fetch(process.env.IMAGE_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.IMAGE_API_KEY
            ? { authorization: `Bearer ${process.env.IMAGE_API_KEY}` }
            : {}),
        },
        body: JSON.stringify({ prompt, width: w || 1024, height: h || 1024 }),
      });
      if (!r.ok) return null;
      const j = await r.json();
      if (j.url || j.b64) return { url: j.url, b64: j.b64 };
      return null;
    }
  } catch {
    return null;
  }
  return null;
}
