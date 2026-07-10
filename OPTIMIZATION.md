# Optimization / master-prompt passes

Reelmint is now a standalone repo. These "master prompt" polish passes have been
applied and verified on `claude/reelmint-separate-project-una478`. Each was
proven with tests, a live server, or a headless-browser check — not just edited.

| # | Master prompt | Status | What changed |
|---|---------------|--------|--------------|
| 1 | `/audit-deps` | ✅ Applied | `npm audit` → **0 vulnerabilities**. CI now fails on high/critical. |
| 2 | `/harden-api` | ✅ Applied | New dependency-free `server/security.js`: CSP + security headers, `x-powered-by` off, CORS allowlist (`CORS_ORIGIN`), fixed-window rate limiting (AI 30/min, auth 20/15 min → verified 429), password min raised to 8. |
| 3 | `/test-suite` | ✅ Applied | `node --test` suite (`test/`) — 15 tests over the product catalog, accounts, credit buckets, referrals and one-time fulfilment. `npm test` wired up. |
| 4 | `/offline-pwa` | ✅ Applied | `manifest.webmanifest`, maskable `icon.svg`, and `sw.js` (network-first API, cache-first shell). Registered from `app.js`; install + 1 SW registration verified in-browser. |
| 5 | `/seo-meta` | ✅ Applied | Open Graph + Twitter cards, canonical URL, `robots.txt` and `sitemap.xml` (all served with correct content-types). |
| 6 | `/accessibility-audit` | ✅ Applied | Skip-to-studio link, `:focus-visible` rings, `prefers-reduced-motion` support, dialog semantics on the auth modal, `role="status"`/`aria-live` toast, labelled canvases. |
| 7 | `/ci-pipeline` | ✅ Applied | CI runs audit → syntax check (incl. `sw.js`) → unit tests → demo-mode smoke test. |
| 8 | `/error-resilience` | ✅ Applied | Credits refund to the exact bucket (monthly vs top-up) on generation failure; image/AI fetches fall back to demo output instead of throwing; store fulfils purchases even without Stripe. |

## Revenue expansion (shipped alongside)

- **Agency** subscription tier.
- **Credit packs** — one-time, pay-as-you-go top-ups.
- **Template Marketplace** — premium packs with a creator revenue split.
- **Referral program** — give-25 / get-25 credits.

See `README.md` for the four-line storefront overview and `server/products.js`
for the catalog.
