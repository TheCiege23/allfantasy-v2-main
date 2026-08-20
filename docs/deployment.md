# AllFantasy — Production Deployment Guide

> **Runtime validator:** `lib/env/validateProductionEnv.ts` checks all required vars at server startup and throws a clear error in production if any are absent. Check `GET /api/health` (`env.valid`, `env.errorCount`, `env.features`) after every deploy.

---

## Required environment variables

These must be set in **Vercel → Project Settings → Environment Variables → Production** (and Preview where applicable). The server will refuse to start if any are missing.

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | Postgres pooled connection (Neon/Vercel preferred) | `postgresql://user:pw@ep-xxx-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require` |
| `DIRECT_URL` | Non-pooled Postgres for Prisma Migrate | `postgresql://user:pw@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require` |
| `NEXTAUTH_SECRET` | Session encryption key — **min 16 chars, never the placeholder** | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Canonical app URL used by NextAuth callbacks | `https://www.allfantasy.ai` |
| `NEXT_PUBLIC_APP_URL` | Public app URL used for invite links and same-origin auth returns | `https://www.allfantasy.ai` |

> Provider aliases accepted for `DATABASE_URL`: `POSTGRES_PRISMA_URL`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `NEON_DATABASE_URL`. The first valid `postgres://` or `postgresql://` URL wins.

---

## Optional environment variables

Missing values degrade features but do not block startup. The health route exposes which features are active (`env.features.*`).

| Variable | Feature | Notes |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Distributed draft locks, BullMQ queue | Pair with `UPSTASH_REDIS_REST_TOKEN`; without Redis, draft races fall back to optimistic DB locking |
| `UPSTASH_REDIS_REST_TOKEN` | — | Required alongside `UPSTASH_REDIS_REST_URL` |
| `REDIS_URL` | Alternative Redis (IORedis BullMQ workers) | TCP; do not set to `/` — IORedis treats that as a Unix socket |
| `OPENAI_API_KEY` | AI matchup analysis, start/sit, draft helper | Legacy alias: `AI_INTEGRATIONS_OPENAI_API_KEY` |
| `DEEPSEEK_API_KEY` | AI (cheaper fallback) | — |
| `XAI_API_KEY` | Grok-powered AI features | Legacy alias: `GROK_API_KEY` |
| `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN` | Error tracking | `withSentryConfig` is a no-op when both are unset |
| `RESEND_API_KEY` | Password-reset + transactional email | Without it, reset links are not emailed (API still returns 200) |
| `RESEND_FROM` | Sender identity | Default: `AllFantasy.ai <noreply@allfantasy.ai>` |
| `STRIPE_SECRET_KEY` | Billing / subscriptions | — |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification | — |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Client-side Stripe.js | — |
| `NEXTAUTH_SECRET` auth alternates | Session / admin | `SESSION_SECRET`, `ADMIN_SESSION_SECRET` |
| `LEAGUE_AUTH_ENCRYPTION_KEY` | External league credential encryption | Min 32 chars |
| `LEAGUE_CRON_SECRET` | Cron job auth | Blank/whitespace = unset |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Google Analytics | Defaults to `G-LY788DCM6K` if unset |
| `ROLLING_INSIGHTS_CLIENT_ID` + `_SECRET` | NFL/multi-sport data (Set 1) | — |
| `ROLLING_INSIGHTS_CLIENT_ID2` + `_SECRET2` | Non-NFL sports (Set 2) | — |
| `CLEARSPORTS_API_KEY` + `CLEARSPORTS_API_BASE` | Player projections / news | — |
| `WORLD_CUP_DATA_PROVIDER` | World Cup official data provider | Production should use `apifootball`; `mock` is local/dev only |
| `API_SPORTS_KEY` / `API_FOOTBALL_KEY` / `APISPORTS_FOOTBALL_KEY` | API-Football provider key for World Cup teams, fixtures, live scores, and standings | Server-only; never `NEXT_PUBLIC_*` |
| `WORLD_CUP_CRON_SECRET` | Secret for World Cup scheduled sync/readiness routes | Send as `Authorization: Bearer <secret>` or `x-cron-secret` |
| `WORLD_CUP_BEST_THIRD_MAPPING_CONFIRMED` | Enables confirmed best-third mapping readiness flag | Keep `false` until FIFA mapping is configured |

---

## Production deploy checklist

Run top-to-bottom before every production push.

- [ ] **Branch** — PR merged into `main`; no outstanding review comments
- [ ] **CI green** — all Vitest + type-check jobs pass in GitHub Actions
- [ ] **Database URL** — `DATABASE_URL` (or alias) set in Vercel Production env; uses a **pooled** URL
- [ ] **Direct URL** — `DIRECT_URL` set to the **non-pooled** URL for Prisma Migrate
- [ ] **Auth secrets** — `NEXTAUTH_SECRET` ≥32 random bytes, `NEXTAUTH_URL` = `https://www.allfantasy.ai`
- [ ] **Public app origin** — `NEXT_PUBLIC_APP_URL` and `APP_URL`/`PUBLIC_SITE_URL` use production HTTPS, not localhost or `127.0.0.1`
- [ ] **World Cup official data** — `WORLD_CUP_DATA_PROVIDER=apifootball`, provider API key set server-side, `WORLD_CUP_CRON_SECRET` set
- [ ] **Prisma migration** — run `npx prisma migrate deploy` against the production database before cutting traffic (see [Migrate flow](#prisma-migrate-flow))
- [ ] **Sentry DSN** — `NEXT_PUBLIC_SENTRY_DSN` set for error tracking (or knowingly absent)
- [ ] **Redis** — `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` set if distributed draft locks are required
- [ ] **Deploy** — trigger Vercel deploy; wait for "Ready" status
- [ ] **Health check** — `GET https://www.allfantasy.ai/api/health` → `ok:true`, `database.connected:true`, `env.valid:true`
- [ ] **World Cup readiness** — `GET /api/brackets/world-cup/admin/readiness` as admin or cron secret → provider configured, groups complete, fixtures loaded, standings synced
- [ ] **World Cup cron smoke** — call `GET /api/brackets/world-cup/cron/sync?job=teams&provider=apifootball` or `job=standings` with `Authorization: Bearer $WORLD_CUP_CRON_SECRET`; verify `ok:true`
- [ ] **World Cup production invite** — create/copy an invite on the production origin; verify no `localhost` or `127.0.0.1` appears
- [ ] **World Cup locks** — verify tournament lock deadline/effective first kickoff locks group-stage, third-place, and knockout edits as expected
- [ ] **Smoke test** — create a league, complete a draft pick, verify waiver run in the UI
- [ ] **Sentry** — confirm no new error bursts in the first 10 minutes
- [ ] **Rollback plan** — previous Vercel deployment URL noted for instant revert

---

## Staging deploy checklist

> Full staging runbook with exact commands: **[docs/staging.md](./staging.md)**

Quick checklist for each PR:

- [ ] Push feature branch — Vercel auto-creates a Preview deployment
- [ ] `NEXTAUTH_URL` set to the preview URL in Vercel Preview env (or use a stable staging alias)
- [ ] All required vars set in Vercel Preview scope (see Required section above)
- [ ] Run `npx prisma migrate deploy` against the staging Neon branch (`DIRECT_URL` = non-pooled staging URL)
- [ ] Run HTTP smoke validation: `BASE_URL=https://<preview-url> npm run staging:validate`
  - `GET /api/health` → `env.valid:true`, `database.connected:true`
- [ ] Open draft room in browser — confirm SSE stream connects (Network tab → filter `stream`)
- [ ] Verify draft pick flow end-to-end (submit pick, watch real-time update in second tab)
- [ ] Verify reconnect: disable network 5s → re-enable → draft state recovers
- [ ] Mobile check: 390px viewport, pick button accessible, timer visible
- [ ] Run k6 load test: `k6 run --env BASE_URL=<preview-url> scripts/load-test/draft-pick.k6.js`
  - All thresholds pass: p95 pick < 800ms, error rate < 5%

---

## Rollback checklist

Use when a production incident requires reverting to the previous stable build.

1. **Vercel instant rollback** — Dashboard → Deployments → previous "Ready" deploy → **Promote to Production** (takes ~30 s)
2. **Verify health** — `GET /api/health` on the reverted URL → `ok:true`
3. **Database** — if the new migration caused the incident, roll back the schema:
   ```bash
   # Mark the last migration as rolled back in _prisma_migrations
   npx prisma migrate resolve --rolled-back <migration_name>
   # Apply the down migration manually if one exists
   psql $DATABASE_URL -f prisma/migrations/<migration_name>/down.sql
   ```
4. **Redis** — if Upstash keys changed, restore previous values in Vercel env
5. **Communicate** — post in #incidents; update status page if public-facing
6. **Post-mortem** — open a GitHub issue with timeline + root cause within 24 hours

---

## Prisma migrate flow

```bash
# 1. Ensure DIRECT_URL (non-pooled) is set — Prisma Migrate needs it
export DIRECT_URL="postgresql://user:pw@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require"

# 2. Preview the pending migrations
npx prisma migrate status

# 3. Apply pending migrations (idempotent; safe to re-run)
npx prisma migrate deploy

# 4. Generate and validate Prisma client/schema
npx prisma generate
npx prisma validate

# 5. Verify
npx prisma db execute --stdin <<< "SELECT COUNT(*) FROM _prisma_migrations WHERE applied_steps_count = 1;"
```

> **Never run `prisma migrate dev` in production.** It creates new migration files and can prompt interactively.
> If Windows keeps locking `query_engine-windows.dll.node`, rerun `npx prisma generate` from a clean terminal after fully closing Cursor/VS Code, or use CI/Linux/Vercel generate output as deploy confidence.

---

## Client bundle secret audit

Run before any PR that changes env var names or adds new `NEXT_PUBLIC_*` vars.

```bash
# Find all NEXT_PUBLIC_ vars referenced in client-side code
grep -r "NEXT_PUBLIC_" --include="*.ts" --include="*.tsx" app/ components/ lib/ | \
  grep -v "process\.env\." | grep -v "\.env"

# Build with bundle analysis to confirm no server vars leak into client chunks
ANALYZE=true npm run build
# Then inspect .next/analyze/client.html — search for secret key names
```

**Never-expose list** (server-only, must not appear in client bundles):

- `DATABASE_URL`, `DIRECT_URL`, `POSTGRES_*`
- `NEXTAUTH_SECRET`, `SESSION_SECRET`, `ADMIN_SESSION_SECRET`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `XAI_API_KEY`
- `UPSTASH_REDIS_REST_TOKEN`, `REDIS_URL`
- `LEAGUE_AUTH_ENCRYPTION_KEY`, `LEAGUE_CRON_SECRET`
- `WORLD_CUP_CRON_SECRET`, `API_SPORTS_KEY`, `API_FOOTBALL_KEY`, `APISPORTS_FOOTBALL_KEY`, `SPORTSDATA_API_KEY`

---

## Health endpoint reference

`GET /api/health` — unauthenticated, always returns HTTP 200.

```jsonc
{
  "ok": true,
  "timestamp": "2026-05-12T00:00:00.000Z",
  "database": {
    "configured": true,   // DATABASE_URL (or alias) present with postgres:// scheme
    "connected": true     // SELECT 1 succeeded
  },
  "env": {
    "valid": true,        // all required vars present and valid
    "errorCount": 0,      // number of blocking validation errors
    "features": {
      "redis": true,      // UPSTASH_REDIS_REST_URL or REDIS_URL set
      "redisFull": true,  // UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN both set
      "sentry": true,     // SENTRY_DSN or NEXT_PUBLIC_SENTRY_DSN set
      "aiProviders": true,// at least one AI key set
      "email": true,      // RESEND_API_KEY set
      "stripe": true      // STRIPE_SECRET_KEY set
    }
  },
  "analytics": {
    "gaMeasurementId": "G-LY788DCM6K",
    "hasMetaPixelId": false,
    "env": "production"
  }
}
```
