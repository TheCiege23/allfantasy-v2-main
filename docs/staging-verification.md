# Staging verification guide

How to actually run the NFL verification passes (browser E2E, scoring cron,
waiver cron, Stripe test flow) against a staging environment. This is the
runbook the sandbox could not execute — the dev server hangs here (see below)
and the only DB available is production.

> Gate every run with the safety check first: `npm run check:staging-env`.
> It refuses to proceed if Stripe keys are live, the cron secret is missing, or
> `DATABASE_URL` looks like production.

---

## 0. Why the dev server hangs in CI/sandbox (and the fix)

`npm run dev` runs `npx -y node@20 …` **twice** (the project pins Node 20 for
Next 14.2.35). On a cold npx cache or constrained network, `npx -y node@20`
re-resolves/downloads the Node-20 wrapper and **hangs at "Starting…"**. It boots
fine when the npx cache is warm — hence the intermittent failures.

**Use the lite launcher** (no `npx node@20`, no pre-clean, uses the Node on PATH):

```bash
npm run dev:staging-lite           # http://127.0.0.1:3010
PORT=3000 npm run dev:staging-lite # custom port
```

If it fails to boot under Node ≠ 20, switch first: `nvm use 20`. Alternatives:
`npm run dev:no-clean` (keeps node@20, skips the clean step) or the bash-only
`npm run dev:unix:stable`.

---

## 1. Required staging env vars

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | **Staging DB**, not production. The validator errors unless the URL contains `staging/dev/test/preview/sandbox` (or you pass `--allow-prod-db`). |
| `NEXTAUTH_SECRET` / `AUTH_SECRET` | ✅ | Login fails without it → browser E2E can't sign in. |
| `PLAYWRIGHT_BASE_URL` | ✅ (browser) | The running staging app URL, e.g. `https://staging.allfantasy.app`. |
| `CRON_SECRET` (or `LEAGUE_CRON_SECRET`) | ✅ | The scheduled crons authenticate the GET with `Authorization: Bearer ${CRON_SECRET}`. |
| `STRIPE_SECRET_KEY` | test only | Must be `sk_test_…`. Validator **errors** on `sk_live_…`. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | test only | Must be `pk_test_…`. |
| `STRIPE_WEBHOOK_SECRET` | ✅ (Stripe) | `whsec_…` from the staging webhook endpoint. |
| `ADMIN_PASSWORD` | optional | Used by `requireAdminOrBearer` for manual admin triggers. |
| `NEXT_PUBLIC_APP_URL` | recommended | App base URL for absolute links / OAuth. |

### Must be TEST mode (never live in staging)
- `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` → `sk_test`/`pk_test`.
- ⚠️ This repo's `.env` currently contains a **live** `sk_live_…`; `.env.local`
  masks it with a test key locally. Ensure the staging deploy ships **only** the
  test key.

### CRON_SECRET / ADMIN_PASSWORD expectation
- Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`.
- The redraft crons (`score-sync`, `waiver-process`) now accept that via
  `requireCronAuth`, so `CRON_SECRET` **need not** equal `ADMIN_PASSWORD`.
- Set `CRON_SECRET` in the Vercel project; it is injected into cron requests.

### OAuth callback URLs
- Add the staging origin to each provider's allowed callback list, e.g.
  `https://staging.…/api/auth/callback/<provider>`. Set `NEXTAUTH_URL` to the
  staging origin.

### Stripe webhook setup
- Create a **test-mode** webhook endpoint pointing at
  `https://staging.…/api/stripe/webhook`, subscribe to
  `checkout.session.completed` + `customer.subscription.*`, and put its signing
  secret in `STRIPE_WEBHOOK_SECRET`.

### Vercel cron expectation
- Crons are GET requests on a schedule (see `vercel.json`). Confirm `CRON_SECRET`
  is set in the Vercel env so the GET authenticates.

---

## 2. Run the safety check (always first)

```bash
npm run check:staging-env
# overrides (DANGEROUS): --allow-prod-db, --allow-live-stripe
```
Exits non-zero (and prints what to fix) unless the env is safe.

---

## 3. NFL full-season ENGINE harness (no browser, real DB)

```bash
npx tsx scripts/run-nfl-full-season-engine-e2e.ts
```
Seeds an isolated league, drives scoring → standings → waivers → trade guard →
playoffs → champion, verifies idempotency, and cascade-cleans. Expect
`PASS 12 · FAIL 0 · BLOCKED 0`. (Requires the `league_championships` migration —
already applied; `npx prisma migrate status` should be clean.)

## 4. NFL Playwright BROWSER E2E (real app)

```bash
RUN_FULL_SEASON_E2E=1 PLAYWRIGHT_BASE_URL=https://staging.… \
  npx playwright test e2e/nfl-full-season.spec.ts --project=chromium
```
Drives the real customer journey (signup → … → champion). Selectors marked
`// SELECTOR:` may need alignment to the live UI on first run.

## 5. score-sync GET verification (deployed cron)

```bash
curl -i -H "Authorization: Bearer ${CRON_SECRET}" \
  https://staging.…/api/redraft/score-sync
```
Expect HTTP 200 with structured JSON (`processed`, `failed`, `dataWarnings`).
Re-run → idempotent (standings unchanged). NCAAF active seasons appear in
`dataWarnings` (skipped, not failed). A 401 means `CRON_SECRET` is wrong.

## 6. waiver-process GET verification (deployed cron)

```bash
curl -i -H "Authorization: Bearer ${CRON_SECRET}" \
  https://staging.…/api/redraft/waiver-process
```
Expect HTTP 200 with `{ processedSeasons, failedSeasons, results }`.

## 7. Stripe TEST checkout + webhook entitlement

1. With test keys configured, start checkout from the app's upgrade flow.
2. Complete payment with a Stripe **test card** (`4242 4242 4242 4242`).
3. Stripe fires `checkout.session.completed` → `/api/stripe/webhook` →
   `userSubscription` row written.
4. Confirm a paid route unlocks for that user and remains blocked for a free user.

Use Stripe CLI to replay/inspect webhooks against staging if needed:
`stripe listen --forward-to https://staging.…/api/stripe/webhook`.

---

## What still needs a human / real environment
- A **staging deploy** with a **staging DATABASE_URL** and **Stripe test keys**.
- OAuth providers configured for the staging origin (for browser login).
- Running steps 4–7 above and recording the results — none can run in the
  sandbox (no app server, production-only DB, live Stripe keys).
