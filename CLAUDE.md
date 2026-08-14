# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Reelmint is a single Node service (Express API + static web app) that "mints"
short/long-form videos, images and marketing copy from one prompt, with a
voice/text AI editor. There is **zero build step** — `server/` is the API,
`public/` is the browser app served statically. It deploys to Render as one
web service.

The project was extracted out of a larger repo into this standalone one; one
module came across without its wiring — see [Unwired modules](#unwired-modules)
before assuming a feature is live.

## Commands

```bash
npm install        # install deps (express, @anthropic-ai/sdk, pg)
npm start          # run the server on http://localhost:3000 (loads .env if present)
npm run dev        # same, with --watch auto-restart
npm test           # run the whole node:test suite (no secrets needed) — 93 tests
npm run test:watch # same, re-running on change
npm run test:coverage   # same, with Node's built-in coverage report
```

Node **≥ 20.12** (`engines`); CI runs Node 22. `start`/`dev` use
`--env-file-if-exists=.env`, so a local `.env` is picked up without `dotenv`.

Run a single test file or a single test by name:

```bash
node --test test/server.test.js
node --test --test-name-pattern="referrals grant bonus credits" test/server.test.js
```

There is no lint step. CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm audit
--audit-level=high` (this one **does** fail the build), `node --check` on
`server/*.js` and `public/app.js`, `npm test`, a coverage report, and a demo-mode
HTTP smoke test — mirror those locally before pushing.

## Layout

```
server/
  index.js       Express app: all routes, COST map, PLANS, SPA fallback, boot
  ai.js          The only Anthropic touch-point: generateText/generateJSON/visionExtract
  prompts.js     All system prompts (role + constraints + output contract + HOUSE_STYLE)
  demo.js        Topic-aware sample content for every AI route (demo mode)
  auth.js        Accounts, scrypt hashing, HMAC tokens, monthly credits, brand kit, referrals
  billing.js     Stripe via REST (no SDK): subscriptions, credit packs, webhook
  images.js      Real image providers → falls back to a browser-rendered design spec
  store.js       Persistence: Postgres (DATABASE_URL) or JSON file, one async API
  products.js    Product catalog — plans, credit packs, addons, templates  ⚠ unwired
  security.js    securityHeaders / cors / rateLimit middleware (mounted in index.js)
public/
  index.html, app.js, styles.css     The browser app (~1200-line app.js, no bundler)
  manifest.webmanifest, icon.svg     PWA manifest (linked from index.html)
  sw.js                              Service worker (registered from app.js boot)
  robots.txt, sitemap.xml            SEO
test/            node:test suites (see Testing) + test/README.md
OPTIMIZATION.md  History of the optimization passes ⚠ describes some things as wired that aren't
```

## Key architecture

**Demo mode is a first-class runtime, not a stub.** When `ANTHROPIC_API_KEY`
is absent the app runs fully in *demo mode*: every AI route returns rich,
topic-aware sample content from `server/demo.js` instead of calling Anthropic.
The entire test suite and CI run in this mode. This is why `server/ai.js`'s
`generateText`/`generateJSON`/`visionExtract` all take a `demo` argument (value
or thunk) and return it when `aiEnabled` is false — **every new AI-backed route
must supply a believable `demo` fallback**, or it will break in demo mode and CI.

**`server/ai.js` is the only Anthropic touch-point.** Routes never call the SDK
directly. Model is `AI_MODEL` (default `claude-opus-4-8`), with `AI_VISION_MODEL`
falling back to it for `/api/scan`. `generateJSON` prefills the assistant turn
with `{` (`JSON_PREFILL`) and parses defensively via `parseLooseJSON` (strips ```
fences / stray prose, never throws — falls back to `demo`). Creative routes run
warm (temp 0.8), structured routes precise (temp 0.4). All system prompts live
centrally in `server/prompts.js` (each has role + constraints + output contract +
the shared `HOUSE_STYLE` guardrails) — edit prompts there, not inline in routes.

**Credit accounting is server-enforced and spend-then-refund.** Paid routes in
`server/index.js` call `spendCredit(user, cost)` *before* generating, and
`refundCredit` in the catch block if generation throws — so a failed AI call never
charges the user. Cost per action is the `COST` map in `index.js`:

```js
{ script: 1, campaignPerPost: 1, trends: 1, ads: 1, thumbnails: 1, article: 2, carousel: 1 }
```

`spendCredit` drains the monthly allowance first, then `bonusCredits` (from
packs/referrals); `publicUser` is the canonical serialization returned to the
client and recomputes `creditsLeft`. Anonymous users (`req.user === null`) are
intentionally *not* gated so the demo stays open — `spendCredit(null)` returns
`{ ok: true, anonymous: true }`.

**Routes and their gating:**

| Route | Gating |
|---|---|
| `GET /api/health` · `GET /api/config` · `GET /api/me` | open |
| `POST /api/auth/signup` · `/api/auth/login` | open |
| `POST /api/assistant` · `/api/image` · `/api/scan` · `/api/repurpose` · `/api/captions` | open, free |
| `POST /api/script` | credits |
| `POST /api/trends` · `/api/thumbnails` · `/api/carousel` | credits, any signed-in user |
| `POST /api/campaign` · `/api/ads` · `/api/article` | credits **+** `isPremium(user)` → `premium_required` |
| `GET/POST /api/brandkit` | premium |
| `POST /api/billing/checkout` · `/credits` · `/webhook` | Stripe config dependent |

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

**Billing uses the Stripe REST API directly** (`server/billing.js`, no Stripe
SDK) and no-ops cleanly when env vars are absent (`stripeEnabled` /
`creditPacksEnabled` gate the routes). Two flows: subscriptions (upgrade plan)
and one-time credit packs (grant `bonusCredits`). The webhook
(`/api/billing/webhook`) is **mounted before the JSON body parser** because
signature verification needs the raw body — keep it first in `index.js`.

Two properties of the webhook are load-bearing and covered by
`test/billing.test.js` — don't regress them:

- `verifySignature` rejects signatures whose timestamp is outside
  `STRIPE_WEBHOOK_TOLERANCE` (default 300s). Stripe signs `t.payload`, so
  without the freshness check a captured delivery replays forever. It takes
  injectable `now`/`secret`/`toleranceSeconds` purely so this is testable.
- Webhook side effects are **idempotent per user**: applied event ids live on
  `user.processedEvents` (capped at 50) and re-delivered events are skipped, so
  a retried or replayed credit-pack purchase cannot stack credits.

**Rendering happens client-side.** `public/app.js` (~1200 lines, organized in
`// ----` sections: boot, tabs, create, canvas, preview, export, editor,
campaign, trends, brand, image, scan) draws storyboards to `<canvas>` and
exports real `.webm` via `MediaRecorder`. The server only returns JSON specs
(storyboards, "Smart Slide" design specs, campaigns) — it never renders media,
which keeps it cheap on Render's free tier. `/api/image` tries a real image
provider first (`server/images.js`) and falls back to a browser-rendered design
spec if none is configured.

## Hardening (live — don't regress it)

`server/security.js` is mounted in `index.js` and covered by `test/security.test.js`:

- **Security headers + CSP** on every response, before the static handler, so they
  apply to the app shell and to error responses too. `x-powered-by` is disabled.
  **`script-src` is `'self'` with no `'unsafe-inline'`** — the app has no inline
  event handlers, no `eval`, and fetches only same-origin, so keep it that way. A
  new inline `<script>` or `onclick=` attribute will be silently blocked in the
  browser. `img-src`/`media-src` allow `blob:` because the canvas `.webm` export
  needs them. HSTS is production-only.
- **CORS is closed by default** (same-origin). Set `CORS_ORIGIN` to a
  comma-separated allowlist to let named origins call the API.
- **Rate limits**, per IP, fixed window, in memory:

  | Scope | Default | Env overrides |
  |---|---|---|
  | The 12 AI routes (`AI_ROUTES` in `index.js`) | 30 / minute | `RATE_LIMIT_AI_MAX`, `RATE_LIMIT_AI_WINDOW_MS` |
  | `/api/auth/signup`, `/api/auth/login` | 20 / 15 min | `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_AUTH_WINDOW_MS` |

  **Add every new AI-backed route to `AI_ROUTES`** — the limiter is mounted by
  path, so a route not on that list is unlimited and can burn the API budget.
  Counts are per process and in memory: they reset on restart and don't add up
  across instances, so a multi-instance deploy multiplies the effective limit.

`public/sw.js` is registered from `registerServiceWorker()` at the end of the boot
sequence in `app.js` (best-effort; skipped on non-HTTPS, non-localhost origins).

## Unwired modules

One thing exists in the tree but is not connected. Check here before "fixing"
behaviour that looks missing, and before assuming `OPTIMIZATION.md` is current:

- **`server/products.js`** — a fuller catalog (Free/Creator/Studio/**Agency**
  plans, credit packs, addons, a template marketplace, `catalog()`). Nothing
  imports it except `test/products.test.js`. The live storefront uses the `PLANS`
  array defined inside `server/index.js` and `CREDIT_PACKS` from
  `server/billing.js`. If you change pricing, change the live ones — or do the
  migration properly and delete the duplicate.

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

## Testing

`npm test` runs `node --test test/**/*.test.js` — **100 tests across 10 files**, all
in demo mode with no keys or network:

| File | Covers |
|---|---|
| `server.test.js` | every route over real HTTP against a spawned server |
| `security.test.js` | headers/CSP, the CORS gate, and the rate limiter's budget, per-client isolation and window refill |
| `auth.test.js` | hashing, token signing, credit buckets, referrals |
| `billing.test.js` | signature verification, replay tolerance, webhook idempotency |
| `ai.test.js` | `aiStatus`, demo passthrough, `parseLooseJSON` |
| `demo.test.js` | demo content is topic-aware and never says "lorem"/"demo mode" |
| `images.test.js` | provider detection and fallback |
| `store.test.js` | backend selection (Postgres vs file) |
| `products.test.js` | catalog integrity (of the unwired `products.js`) |
| `integration.test.js` | cross-module env handling |

`server.test.js` **spawns the server as a child process** (`server/index.js` always
calls `app.listen`; it does not export the app). Two consequences worth knowing:

- `--experimental-test-coverage` instruments only the current process, so
  **`server/index.js` is absent from the coverage report entirely** — the ~83%
  overall figure covers the modules imported directly by unit tests, not the
  routes. Don't read it as route coverage.
- The whole file drives the API from one address, so it raises
  `RATE_LIMIT_AI_MAX`/`RATE_LIMIT_AUTH_MAX` in the child's env to keep the
  production budgets from throttling the suite. `security.test.js` covers the
  limiter's real behaviour instead.

Making `index.js` export `{ app, initStore }` and guard `app.listen` behind a
run-directly check would let the suite listen in-process and put the routes back
in the coverage report — a worthwhile follow-up, not done here.

Add a test alongside any new route or logic.

## Git workflow

- Default branch is `main`. Do work on a feature branch and push with
  `git push -u origin <branch>`; retry network failures with exponential backoff.
- **Do not open a pull request unless explicitly asked.**
- If a designated branch's PR has already merged, restart the branch from the
  latest `main` for follow-up work rather than stacking onto merged history.
- Keep this file honest — update it in the same change as any structural change.
