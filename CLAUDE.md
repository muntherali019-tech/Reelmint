# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Reelmint is a single Node service (Express API + static web app) that "mints"
short/long-form videos, images and marketing copy from one prompt, with a
voice/text AI editor. There is **zero build step** — `server/` is the API,
`public/` is the browser app served statically. It deploys to Render as one
web service.

## Commands

```bash
npm install        # install deps (express, @anthropic-ai/sdk, pg)
npm start          # run the server on http://localhost:3000
npm run dev        # same, with --watch auto-restart
npm test           # run the whole node:test suite (no secrets needed)
npm run test:coverage   # same, with Node's built-in coverage report
```

Run a single test file or a single test by name:

```bash
node --test test/server.test.js
node --test --test-name-pattern="referrals grant bonus credits" test/server.test.js
```

There is no lint step. CI (`.github/workflows/ci.yml`) runs `npm audit
--audit-level=high`, `node --check` on every JS file, `npm test`, and a
demo-mode HTTP smoke test — mirror those locally before pushing.

## Key architecture

**Demo mode is a first-class runtime, not a stub.** When `ANTHROPIC_API_KEY`
is absent the app runs fully in *demo mode*: every AI route returns rich,
topic-aware sample content from `server/demo.js` instead of calling Anthropic.
The entire test suite and CI run in this mode. This is why `server/ai.js`'s
`generateText`/`generateJSON`/`visionExtract` all take a `demo` argument (value
or thunk) and return it when `aiEnabled` is false — **every new AI-backed route
must supply a believable `demo` fallback**, or it will break in demo mode and CI.

**`server/ai.js` is the only Anthropic touch-point.** Routes never call the SDK
directly. `generateJSON` prefills the assistant turn with `{` (`JSON_PREFILL`)
and parses defensively via `parseLooseJSON` (strips ``` fences / stray prose,
never throws — falls back to `demo`). Creative routes run warm (temp 0.8),
structured routes precise (temp 0.4). All system prompts live centrally in
`server/prompts.js` (each has role + constraints + output contract + the shared
`HOUSE_STYLE` guardrails) — edit prompts there, not inline in routes.

**Credit accounting is server-enforced and spend-then-refund.** Paid routes in
`server/index.js` (`/api/script`, `/api/campaign`, `/api/trends`, `/api/ads`,
`/api/thumbnails`, `/api/carousel`, `/api/article`) call `spendCredit(user, cost)`
*before* generating, and `refundCredit` in the catch block if generation throws —
so a failed AI call never charges the user. Cost per action is the `COST` map in
`index.js`. `spendCredit` drains the monthly allowance first, then `bonusCredits`
(from packs/referrals); `publicUser` is the canonical serialization returned to
the client and recomputes `creditsLeft`. Anonymous users (`req.user === null`)
are intentionally *not* gated so the demo stays open — `spendCredit(null)`
returns `{ ok: true, anonymous: true }`. Premium-only tools (`/api/campaign`,
`/api/ads`, `/api/article`, plus Brand Kit) additionally gate on `isPremium(user)`
and return a `premium_required` error; credit-costed open tools (`/api/thumbnails`,
`/api/carousel`, `/api/trends`) charge credits but stay usable by any signed-in
user.

**Auth is dependency-free** (`server/auth.js`): scrypt password hashing and
HMAC-signed `userId.exp.sig` tokens (no JWT lib). `attachUser` middleware sets
`req.user` from the Bearer token on every request. `AUTH_SECRET` must be set in
production or tokens won't survive a restart. Premium gating goes through
`isPremium(user)` / `PREMIUM_PLANS` (creator + studio).

**Storage is one async API with two backends** (`server/store.js`), chosen at
boot by whether `DATABASE_URL` is set: Postgres (users as JSONB, table created
on boot) or a JSON file under `DATA_DIR` (debounced writes, default `./.data`).
Never assume a backend in application code — always go through the exported
`getUser*`/`saveUser` functions. Tests use the file backend via a temp
`DATA_DIR`.

**`server/products.js` is the single source of truth for everything for sale.**
Plans (with `PLAN_CREDITS`) and one-time credit packs live there and nowhere
else: `auth.js` re-exports `PLAN_CREDITS`, `billing.js` builds Checkout from it,
and `/api/config` serves `catalog()` straight to the storefront. Don't
re-declare a plan list in `index.js` — that duplication is what let an "agency"
tier exist with no credit allowance, which `setPlan` would have silently
no-opped after taking the money. Adding a SKU means editing products.js only;
`catalog()` strips the server-only `stripePrice` field before it reaches the
browser.

**Billing uses the Stripe REST API directly** (`server/billing.js`, no Stripe
SDK) and no-ops cleanly when env vars are absent (`stripeEnabled` /
`creditPacksEnabled` gate the routes). Two flows: subscriptions (upgrade plan)
and one-time credit packs (grant `bonusCredits`). The webhook
(`/api/billing/webhook`) is **mounted before the JSON body parser** because
signature verification needs the raw body — keep it first in `index.js`.

**Going live requires only `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`.**
`buildLineItem` sends inline `price_data` derived from each SKU's `amount`, so
no Products or Prices have to be created in the Stripe dashboard first — that
manual setup was the longest step between a finished build and a first payment.
A `STRIPE_PRICE_*` env var, when set, overrides the inline amount for that SKU
(`price` and `price_data` are mutually exclusive in the Stripe API — never send
both). Keep display strings (`price`) in step with `amount`; `products.test.js`
asserts they agree, because a drift there mis-prices a real sale.

Two properties of the webhook are load-bearing and covered by
`test/billing.test.js` — don't regress them:

- `verifySignature` rejects signatures whose timestamp is outside
  `STRIPE_WEBHOOK_TOLERANCE` (default 300s). Stripe signs `t.payload`, so
  without the freshness check a captured delivery replays forever. It takes
  injectable `now`/`secret`/`toleranceSeconds` purely so this is testable.
- Webhook side effects are **idempotent per user**: applied event ids live on
  `user.processedEvents` (capped at 50) and re-delivered events are skipped, so
  a retried or replayed credit-pack purchase cannot stack credits.

**Tests run the app in-process.** `server/index.js` exports `{ app, initStore }`
and only calls `app.listen` when run directly, so `test/server.test.js` can
listen on an ephemeral port. Keep it that way: `--experimental-test-coverage`
instruments only the current process, so spawning the server as a child hides
`index.js`, `billing.js` and `ai.js` from the report entirely.

**Rendering happens client-side.** `public/app.js` (~1000 lines, organized in
`// ----` sections: boot, tabs, create, canvas, preview, export, editor,
campaign, trends, brand, image, scan) draws storyboards to `<canvas>` and
exports real `.webm` via `MediaRecorder`. The server only returns JSON specs
(storyboards, "Smart Slide" design specs, campaigns) — it never renders media,
which keeps it cheap on Render's free tier. `/api/image` tries a real image
provider first (`server/images.js`) and falls back to a browser-rendered design
spec if none is configured.

## Conventions

- **ES modules throughout** (`"type": "module"`), Node ≥ 20, `node:` prefix for
  built-ins.
- Async route handlers are wrapped with `wrap()` in `index.js` so rejected
  promises hit the global error handler instead of hanging the request. Use it
  for any new async route.
- Unmatched `/api/*` paths return a JSON 404 (`app.all("/api/*", …)`) placed
  **before** the SPA catch-all (`app.get("*")`); keep that ordering so API
  clients never receive the HTML shell.
- When adding a route that returns user-affecting state, include
  `user: publicUser(req.user)` in the response so the client stays in sync.
- Config/secrets are all env vars (see `.env.example` and the README table);
  every integration degrades gracefully when its vars are missing.
