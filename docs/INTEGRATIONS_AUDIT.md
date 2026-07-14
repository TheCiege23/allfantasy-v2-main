# AllFantasy — Third-Party Integrations Audit

> **Generated:** 2026-07-12 · **Scope:** every external service the app talks to — env vars, client wrappers, routes, fallback behavior, test coverage, and gaps.
> **Method:** read of `.env.example` (400-line canonical reference), `lib/*-client.ts` wrappers, `app/api/**` routes, `__tests__/**`, and a **masked** local-config presence check (set/missing only — no secret values were read out).
> **Config-status caveat:** the "Local" column reflects **`.env` / `.env.local` on this machine only**. Production config lives on Vercel/Railway and is **not** visible from the repo. Treat "Local: missing" as "not set for local dev," not "broken in prod."

---

## 1. Executive summary

There is **no installed-but-unwired service** in this codebase. Email (Resend), SMS/phone (Twilio), payments (Stripe), push (web-push), four AI providers, eight sports-data providers, and the full auth/analytics/media stack are all integrated — most of them maturely, with graceful degradation when a key is absent and real test coverage.

The value in this audit is therefore not "what to wire" but **"what's configured vs. missing, and where the loose ends are."** Those are in §5.

**Integration count:** ~40 external services across 9 categories.

---

## 2. Local config status (masked)

Presence in local `.env` / `.env.local` only. `SET` = non-empty value present. `--` = missing/empty locally.

| Service | Key(s) checked | Local |
|---|---|---|
| Neon Postgres | `DATABASE_URL`, `DIRECT_URL` | ✅ SET |
| Redis | `REDIS_URL` | ✅ SET |
| Vercel Blob | `BLOB_READ_WRITE_TOKEN` | ✅ SET |
| Sentry | `NEXT_PUBLIC_SENTRY_DSN` | ❌ missing |
| NextAuth | `NEXTAUTH_SECRET` | ✅ SET |
| League-auth crypto | `LEAGUE_AUTH_ENCRYPTION_KEY` | ✅ SET |
| Google OAuth | `GOOGLE_CLIENT_ID` | ✅ SET |
| Yahoo OAuth | `YAHOO_CLIENT_ID` | ✅ SET |
| Discord | `DISCORD_BOT_TOKEN` | ✅ SET |
| OpenAI | `OPENAI_API_KEY` | ✅ SET |
| Anthropic | `ANTHROPIC_API_KEY` | ✅ SET *(undocumented — see §5.2)* |
| DeepSeek | `DEEPSEEK_API_KEY` | ✅ SET |
| xAI / Grok | `XAI_API_KEY` | ✅ SET |
| ElevenLabs | `ELEVENLABS_API_KEY` | ✅ SET |
| DeepL | `DEEPL_API_KEY` | ❌ missing *(optional)* |
| Resend | `RESEND_API_KEY`, `RESEND_FROM` | ✅ SET |
| Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` | ✅ SET |
| web-push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | ❌ **missing** *(push silently no-ops — see §5.3)* |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ✅ SET |
| Coinbase Commerce | `COINBASE_COMMERCE_API_KEY` | ❌ missing |
| PayPal | `PAYPAL_CLIENT_ID` | ❌ missing |
| Rolling Insights | `ROLLING_INSIGHTS_API_KEY`, `ROLLING_INSIGHTS_CLIENT_ID` | ✅ SET |
| API-Sports | `API_SPORTS_KEY` | ✅ SET |
| TheSportsDB | `THESPORTSDB_API_KEY` | ✅ SET *(6 chars — likely free-tier `123`)* |
| ClearSports | `CLEARSPORTS_API_KEY` | ✅ SET |
| CollegeFootballData | `CFBD_KEY` | ✅ SET |
| SportsData.io | `SPORTSDATA_API_KEY` | ❌ missing *(alt WC provider)* |
| NewsAPI | `NEWSAPI_KEY` | ✅ SET |
| Serper (search) | `SERPER_API_KEY` | ✅ SET |
| OpenWeatherMap | `OPENWEATHERMAP_API_KEY` | ✅ SET |
| Google Search | `GOOGLE_SEARCH_API_KEY` | ✅ SET |
| Giphy | `GIPHY_API_KEY` | ✅ SET |
| Tenor | `NEXT_PUBLIC_TENOR_API_KEY` | ❌ missing *(fallback)* |
| Klipy | `KLIPY_API_KEY` | ❌ missing *(primary GIF — falls back to Giphy)* |
| Cloudinary | `CLOUDINARY_API_KEY` | ✅ SET |
| Meta CAPI | `META_CONVERSIONS_API_TOKEN` | ✅ SET |
| Google Analytics | `NEXT_PUBLIC_GA_MEASUREMENT_ID` | ✅ SET |
| ProxyCheck | `PROXYCHECK_API_KEY` | ❌ missing *(optional VPN detect)* |
| Cron auth | `CRON_SECRET`, `LEAGUE_CRON_SECRET` | ✅ SET |
| World Cup provider | `WORLD_CUP_DATA_PROVIDER` | ✅ SET |

---

## 3. Integrations by category

### 3.1 Infrastructure & data

| Service | Purpose | Env vars | Wrapper / entry | Required? |
|---|---|---|---|---|
| **Neon (Postgres)** | Primary DB | `DATABASE_URL` (pooled), `DIRECT_URL` (migrations) | `lib/prisma.ts`, `lib/env/database-url.ts`, Prisma | **Required** — app cannot run without it |
| **Redis** | Caches, automation locks, BullMQ queues | `REDIS_URL` or `REDIS_HOST`/`REDIS_PORT` | `ioredis`, `lib/automation/locks.ts` | **Optional** — falls back to in-memory caches / Postgres locks |
| **Vercel Blob** | File/image uploads (chat, media) | `BLOB_READ_WRITE_TOKEN` | `@vercel/blob` | Optional — upload features 501 without it |
| **Sentry** | Error tracking | `NEXT_PUBLIC_SENTRY_DSN` (public) | `sentry.{client,server,edge}.config.ts`, `instrumentation.ts` | Optional — no capture when DSN empty (**missing locally**) |

### 3.2 Communications

| Service | Purpose | Env vars | Wrapper | Key routes / callers | Fallback when unset |
|---|---|---|---|---|---|
| **Resend** | All transactional email | `RESEND_API_KEY`, `RESEND_FROM` (+ `RESEND_FROM_EMAIL`) | `lib/resend-client.ts` | `NotificationDispatcher`, `notification-engine`, league invites (`app/api/commissioner/leagues/[leagueId]/invite/send`), `/forgot-password`, weekly summary, world-cup reminders, import + trade alerts, growth flows | Dev falls back to `onboarding@resend.dev`; prod **throws** without `RESEND_FROM`. Password reset returns success even if unsent (no account enumeration) |
| **Twilio** | SMS + phone verification | `TWILIO_ACCOUNT_SID` + (`TWILIO_AUTH_TOKEN` \| `TWILIO_API_KEY`+`TWILIO_API_SECRET`); `TWILIO_PHONE_NUMBER`, `TWILIO_VERIFY_SERVICE_SID` | `lib/twilio-client.ts` | `app/api/verify/phone/*`, `app/api/auth/phone/*`, password reset, `NotificationDispatcher` SMS channel | `sendSms()` returns `false` (no throw); `getTwilioRuntimeStatus()` reports capability |
| **web-push** | Browser push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_MAILTO` | `lib/push-notifications/push-service.ts` | `sendPushToUser` in `NotificationDispatcher`, push subscription routes | Returns `{ok:false,"VAPID not configured"}` — **silently no-ops (missing locally)** |

`lib/notifications/NotificationDispatcher.ts` is the **single entry point** fanning one event out to in-app + email + SMS + push, gated by each user's category prefs and contact availability, with retry/backoff on email.

### 3.3 Payments

| Service | Purpose | Env vars | Wrapper | Key routes | Status |
|---|---|---|---|---|---|
| **Stripe** | Subscriptions, league entry fees, tokens, brackets, donations | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_*` (11), `STRIPE_CHECKOUT_LINK_*` (14) | `lib/stripe-client.ts` (API `2026-02-25.clover`), `lib/monetization/catalog.ts` | `app/api/stripe/webhook`, `create-checkout-session`, `leagues/[id]/finance/entry-checkout`, `subscription/billing-portal`, `bracket/stripe/*`, `donate`, `monetization/checkout` | ✅ Active, well-covered by tests |
| **Coinbase Commerce** | *(no processor integration)* | `COINBASE_COMMERCE_API_KEY`, `COINBASE_API_KEY` | — | `app/api/test-keys` (key probe only) | Env keys read **only** by the diagnostic route — no checkout/webhook. Not configured |
| **PayPal** | *(no processor integration)* | `PAYPAL_CLIENT_ID/SECRET` | — | `app/api/test-keys` (key probe only) | Same — diagnostic probe only, no processor code |

> **Note:** `paypal`/`coinbase` *do* appear as first-class features — but as **manual off-platform payment presets** (`lib/league-finance/manualPaymentPresets.ts` → `LeagueDues.paymentProvider`: PayPal / Coinbase / Venmo / Zelle / cash / escrow). That's a commissioner **recording** that dues were paid elsewhere, not the app processing the payment. **Stripe is the only real payment processor.**

### 3.4 AI providers

Multi-provider orchestration with health checks, fallback, and cost control (`AI_ORCHESTRATION_*`, `lib/ai/...`, `ai-cost-control-service`, `providerRouter`).

| Provider | Purpose | Env vars | Wrapper | Notes |
|---|---|---|---|---|
| **OpenAI** | Primary LLM + TTS | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_TTS_*`, `AI_INTEGRATIONS_OPENAI_*` | `lib/openai-client.ts` | Canonical + legacy alias keys |
| **Anthropic** | LLM (Claude) | `ANTHROPIC_API_KEY` | `@anthropic-ai/sdk`, `app/api/start-sit/chimmy.route.js`, AI provider router | **Active but undocumented in `.env.example`** — see §5.2 |
| **DeepSeek** | LLM (cost/fallback) | `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL` | `lib/deepseek-client.ts` | |
| **xAI / Grok** | LLM + enrichment | `XAI_API_KEY`, `XAI_MODEL`, `XAI_BASE_URL` (+ legacy `GROK_*`, `GROK_ENRICH_*` flags) | `lib/xai-client.ts` | Two naming generations coexist |
| **ElevenLabs** | Chimmy voice TTS | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, … | `/api/tts`, `/api/chimmy/voice` | OpenAI TTS is the fallback |
| **DeepL** | Translation fallback | `DEEPL_API_KEY` | — | Optional; **missing locally** |
| **Openclaw** | Internal dev/growth assistants | `OPENCLAW_*` | — | Server-side only, host-allowlisted |

### 3.5 Sports data providers

| Provider | Purpose | Env vars | Wrapper | Notes |
|---|---|---|---|---|
| **Sleeper** | Leagues, rosters, players, trades import | — (public API) | `lib/sleeper-client.ts`, `lib/sleeper-sync.ts`, `lib/sports-data-gateway/` | The validated proof-path provider |
| **ESPN** | Scores / supplemental | `ESPN_SOCCER_PATH` | `lib/espn-client.ts` | Mostly keyless public endpoints |
| **Rolling Insights** | Live stats/scores (REST + OAuth) | `ROLLING_INSIGHTS_CLIENT_ID/SECRET` (×2 sets), `ROLLING_INSIGHTS_REST_BASE`, `RI_*_ENABLED` per-sport flags | `lib/sports-*` | NFL enabled; other sports flagged off |
| **API-Sports** | Stats + World Cup football | `API_SPORTS_KEY`, `API_FOOTBALL_KEY`/`APISPORTS_FOOTBALL_KEY` | `lib/api-sports.ts` | |
| **TheSportsDB** | Teams/logos/metadata | `THESPORTSDB_API_KEY` (+ league IDs) | — | Local key is 6 chars → likely free-tier |
| **ClearSports** | Projections / news alerts | `CLEARSPORTS_API_KEY`, `CLEARSPORTS_API_BASE` (+ legacy `CLEAR_SPORTS_*`) | `lib/clear-sports.ts` | Feature-gated, health-probed |
| **CollegeFootballData** | NCAAF data | `CFBD_KEY` | — | `cfbd-provider-support.test.ts` |
| **SportsData.io** | Alt World Cup provider | `SPORTSDATA_API_KEY` | — | **Missing locally**; `WORLD_CUP_DATA_PROVIDER` selects active provider |

### 3.6 Auth / OAuth

| Service | Env vars | Notes |
|---|---|---|
| **NextAuth** | `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `SESSION_SECRET`, `ADMIN_*` | Core session layer (`lib/auth.ts`) |
| **Google Sign-In** | `GOOGLE_CLIENT_ID/SECRET`, `NEXT_PUBLIC_ENABLE_GOOGLE_AUTH` | Redirect-URI notes in `.env.example` |
| **Yahoo** | `YAHOO_CLIENT_ID/SECRET`, `YAHOO_REDIRECT_URI` | League import OAuth |
| **Discord** | `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN` | Public client_id hardcoded; `app/api/community/discord/webhook` |
| **Apple / Spotify** | `NEXT_PUBLIC_ENABLE_{APPLE,SPOTIFY}_AUTH` | Toggles only (Apple hard-disabled per memory) |
| **League-auth encryption** | `LEAGUE_AUTH_ENCRYPTION_KEY` | Encrypts external league credentials |

### 3.7 Media / GIF / images

Giphy (`GIPHY_API_KEY` + public), Tenor (`NEXT_PUBLIC_TENOR_API_KEY`), Klipy (`KLIPY_API_KEY`, primary server-side), Cloudinary (`CLOUDINARY_*`, World Cup pool-chat uploads). GIF priority: **Klipy → Tenor → Giphy**. Locally only Giphy is set, so the chain falls straight through to Giphy.

### 3.8 Analytics / marketing

Meta Conversions API + Pixel (`META_CONVERSIONS_API_TOKEN`, `META_PIXEL_ID`, `NEXT_PUBLIC_*`), Google Analytics (`NEXT_PUBLIC_GA_MEASUREMENT_ID`), plus `lib/meta-client.ts`.

### 3.9 News / search / weather / geo

NewsAPI (`NEWSAPI_KEY`/`NEWS_API_KEY`), Serper (`SERPER_API_KEY`), OpenWeatherMap (`OPENWEATHERMAP_API_KEY`), Google Programmable Search (`GOOGLE_SEARCH_API_KEY`+`GOOGLE_SEARCH_CX`), ProxyCheck/ipapi for VPN detection (optional — Vercel geo headers are the base signal).

### 3.10 Cron / automation auth

Multiple secrets accepted: `CRON_SECRET`, `LEAGUE_CRON_SECRET`, `AI_ADP_CRON_SECRET`, `WORLD_CUP_CRON_SECRET`, `BRACKET_CRON_SECRET`, `IMPORT_WORKER_SECRET`, plus `BRACKET_ADMIN_SECRET`/`ADMIN_PASSWORD`. Schedules live in `vercel.json` `crons` (18+ jobs) and `app/api/cron/**`. Shared helper: `app/api/cron/_auth.ts` (`requireCronAuth`) — but see §5.7.

---

## 4. Test coverage

110+ integration-related test files. Strongest coverage: **AI** (`__tests__/ai/*`, provider router, model routing, cost control, env verification), **monetization/Stripe** (checkout routes, catalog, webhook contract, analytics), **sports providers** (`g45`–`g49` foundation→wiring→certification, `cfbd-provider-support`, `admin-provider-health`), **notifications** (`commissioner-os-notifications`, `draft-intel-notification-settings`, `g42-...-notifications`), **email** (`admin-email-broadcast`, `email-unsubscribe-token`).

Thin spots: no dedicated test found for the `notification_outbox` delivery path (because it has no consumer — §5.1); web-push send path is lightly exercised.

---

## 5. Key findings & gaps (prioritized)

### 5.1 `notification_outbox` is a consumer-less durable queue (dead path)
`lib/automation/notifications.ts` writes to the `notification_outbox` table (full retry schema: `status`/`sendAfter`/`attemptCount`/`maxAttempts`/`lastError`). Its own comments say a "later worker" would dispatch email/SMS from it — **that worker was never built** (no consumer found; `AutomationJobType` reserves `"notifications.dispatch"` but nothing implements it). Meanwhile the live `NotificationDispatcher` already sends email/SMS **synchronously**. **Naively wiring an outbox worker now would double-send.** Decision needed: (a) delete the outbox scaffold, or (b) make it the durable-retry backbone *behind* the dispatcher (dispatcher enqueues; worker sends) — not a parallel path.

### 5.2 Anthropic is active but undocumented
`@anthropic-ai/sdk` + `ANTHROPIC_API_KEY` are used in `app/api/start-sit/chimmy.route.js` and the AI provider router (and set locally), but **`ANTHROPIC_API_KEY` is absent from `.env.example`**. A fresh deployer following the template would ship without Claude and not know why. **Fix:** add it to `.env.example` under the AI section.

### 5.3 web-push (VAPID) not configured locally → push silently no-ops
Push is wired through the dispatcher, but `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` are missing locally, so `push-service.ts` returns "VAPID not configured" and drops sends without error. Confirm prod has VAPID set; otherwise the entire push channel is dark in production too.

### 5.4 Sentry DSN empty locally
Four Sentry config files are present but `NEXT_PUBLIC_SENTRY_DSN` is empty locally → no client-side error capture in dev. Likely intentional for local, but confirm the prod/Vercel env actually sets it, or client errors go uncaptured.

### 5.5 Coinbase/PayPal env keys are effectively dead
`COINBASE_COMMERCE_API_KEY`, `COINBASE_API_KEY`, `PAYPAL_CLIENT_ID/SECRET` are consumed by **only** `app/api/test-keys/route.ts` (a key-presence probe) — there is no processor client, checkout, or webhook. The genuine PayPal/Coinbase feature is **manual payment tracking** (off-platform presets, §3.3 note), which needs no API keys. **Recommendation:** drop these four keys from `.env.example` (they imply an integration that doesn't exist), and confirm `app/api/test-keys` is not reachable in production.

### 5.6 Env-var alias sprawl
Multiple legacy/canonical pairs invite drift: `CLEARSPORTS_*` vs `CLEAR_SPORTS_*`, `XAI_*` vs `GROK_*`, `NEWSAPI_KEY` vs `NEWS_API_KEY`, `RESEND_FROM` vs `RESEND_FROM_EMAIL`, `AI_INTEGRATIONS_OPENAI_*` vs `OPENAI_*`, `API_FOOTBALL_KEY` vs `APISPORTS_FOOTBALL_KEY`. Worth a consolidation pass with deprecation comments.

### 5.7 Cron auth is inconsistent
A shared `requireCronAuth` helper exists in `app/api/cron/_auth.ts` (accepts several secrets/headers), but `app/api/cron/waivers/route.ts` uses its **own inline** `authorizeCron` that only checks `CRON_SECRET`. Standardize on the shared helper so every cron endpoint honors the same secret set.

---

## 6. How to extend this audit

- **Verify prod config:** `vercel env ls` (once the Vercel CLI is installed and the project linked) to confirm the "missing locally" keys are set in Production.
- **Regenerate the local matrix:** re-run the masked presence check (§2) — it reads only presence + length, never values.
- **Per-service deep dive:** each `lib/*-client.ts` wrapper documents its own required env vars and fallback behavior in a `getRequiredEnv`/runtime-status pattern; start there.
