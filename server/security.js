// Zero-dependency hardening for the Reelmint API: security headers, a small
// in-memory rate limiter, and a CORS gate. Kept deliberately dependency-free so
// it stays deployable on any host with nothing to install.

// ---- security headers ----
export function securityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-XSS-Protection", "0"); // modern browsers rely on CSP, not this
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()");
  // The app is a static bundle + same-origin API. Allow the inline styles the
  // canvas/UI use and connections to self; block plugins and framing.
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")
  );
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

// ---- CORS ----
// Same-origin by default. Set CORS_ORIGIN to a comma-separated allowlist to let
// named origins call the API (e.g. a separate marketing domain).
const ALLOWED = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && ALLOWED.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.status(204).end();
  }
  next();
}

// ---- rate limiter (fixed window, in-memory) ----
// Good enough for a single instance; swap for a shared store if you scale out.
export function rateLimit({ windowMs, max, key = ipKey } = {}) {
  const hits = new Map();
  // Periodically drop stale buckets so memory can't grow unbounded.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  }, windowMs);
  if (typeof sweep.unref === "function") sweep.unref();

  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    let bucket = hits.get(k);
    if (!bucket || now > bucket.reset) {
      bucket = { count: 0, reset: now + windowMs };
      hits.set(k, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil((bucket.reset - now) / 1000)));
    if (bucket.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.reset - now) / 1000)));
      return res.status(429).json({ error: "rate_limited", retryAfterSec: Math.ceil((bucket.reset - now) / 1000) });
    }
    next();
  };
}

function ipKey(req) {
  // trust proxy is set, so req.ip is the real client behind Render's proxy.
  return req.ip || req.headers["x-forwarded-for"] || "anon";
}
