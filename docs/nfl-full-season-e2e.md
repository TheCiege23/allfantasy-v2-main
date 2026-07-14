# NFL full-season E2E

Proves a paying commissioner can complete an entire NFL redraft season. Two
layers, sharing one reusable harness:

| Layer | File | Runs where | Verifies |
|---|---|---|---|
| **Reusable harness** | `tests/helpers/redraftSeasonHarness.ts` | node/tsx | seed + drive + cascade-cleanup of an isolated NFL league |
| **Engine-level runner** | `scripts/run-nfl-full-season-engine-e2e.ts` | node/tsx + real DB | season *mechanics*: scoring, standings, waivers, trade guard, playoffs, champion |
| **Browser spec** | `e2e/nfl-full-season.spec.ts` | Playwright + running app | the *customer UI journey* (signup → subscribe → … → champion) |

The engine runner is the part that runs without a browser. The browser spec
covers the UI clicks that the engine layer can't (signup, Stripe, draft room,
lineup, trade UI). Both use the same harness for seeding and self-cleaning.

## Required environment

- `DATABASE_URL` — Postgres/Neon (engine runner + harness). Loaded from `.env`/`.env.local`.
- `PLAYWRIGHT_BASE_URL` — the running app (browser spec only). Default `http://localhost:3000`.
- `RUN_FULL_SEASON_E2E=1` — opt-in flag for the browser spec (skipped otherwise).
- For the scheduled scoring step: the cron secret the GET `/api/redraft/score-sync`
  route expects (`requireAdminOrBearer` → `ADMIN_PASSWORD`/`x-cron-secret`).
- For a real subscription step: Stripe **test** keys, or seed the entitlement via the harness.

## How to run

**Engine-level (no browser — runs against a real DB, self-cleaning):**

```bash
npx tsx scripts/run-nfl-full-season-engine-e2e.ts
```

Seeds an isolated league under an `E2E-NFL-<ts>` marker, drives the season, prints
`PASS/FAIL/BLOCKED` per step, and cascade-deletes everything on exit. Safe in staging.

**Browser (full customer journey — needs the app running):**

```bash
RUN_FULL_SEASON_E2E=1 PLAYWRIGHT_BASE_URL=http://localhost:3000 \
  npx playwright test e2e/nfl-full-season.spec.ts --project=chromium
```

Selectors in the spec marked `// SELECTOR:` were written from route/feature
knowledge, not a live DOM — confirm them on first run.

## What the engine runner covers (steps → checks)

1–7 seed user/league/season/rosters · 8–9 roster setup · 11–13 scoring sync +
matchup scores + standings accumulation across weeks · 14–16 waiver add/drop/FAAB ·
17–19 trade finalization concurrency guard · 20 advance to playoffs · 21–22 playoff
bracket advance · 23–25 champion crowning + idempotency · 26 cleanup.

## What only the browser spec can verify

Signup, Stripe subscription/entitlement gating, league-creation **wizard**, the
draft **room** UI, lineup setting, the waiver/trade **UI**, and that each tab
(Matchups, Standings, Playoffs) **renders** the engine state. The engine runner
proves the data is correct; the browser proves the customer can drive it.

## Current result (engine runner, against real DB) — 2026-06-26

**9 PASS · 0 FAIL · 1 BLOCKED.** Scoring, standings, waivers, trade guard, and
playoff round advancement all pass with real data and are idempotent. The one
blocked step is champion crowning.

### Bugs the harness found and fixed
1. `advancePlayoffWinners` wrote playoff **matchup** `status: 'complete'`, but the
   DB CHECK allows `scheduled/in_progress/final/bye/cancelled` → playoff
   advancement crashed. Fixed to `'final'`.
2. `advancePlayoffWinners` wrote playoff **round** `status: 'complete'`, and
   `finalizeRedraftSeasonChampion` checked `=== 'complete'`, but the DB CHECK
   requires `'completed'` → round completion crashed. Fixed both to `'completed'`.

### Remaining blocker (infrastructure, not code)
3. **`league_championships` table is missing from the database.** The
   `LeagueChampionship` model is in `prisma/schema.prisma` but no migration ever
   created the table, so `finalizeRedraftSeasonChampion` throws
   `table public.league_championships does not exist`. **No season can crown a
   champion until this migration is applied.** This requires a DB migration via
   the deploy process — do not hand-create the table in production.

## Acceptance status

- ✅ Harness seeds a full NFL redraft league and cleans up after itself (0 leftover rows verified).
- ✅ Engine-level fallback checks verify scoring/waivers/trades/playoffs against a real DB.
- ✅ The browser spec documents every customer step (opt-in, not executed in this environment).
- ✅ Clearly reports PASS/FAIL/BLOCKED.
- ✅ Safe to run in staging (isolated + cascade cleanup).
- ⛔ The **full** authenticated season does **not** yet pass end-to-end: champion
  crowning is blocked by the missing migration, and the browser journey has not
  been executed (no running app in the build environment).
