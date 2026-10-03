# Known Gaps — Sleeper (append here instead of probing)

**Purpose:** record what we don't know about Sleeper's public feeds so nobody re-probes to
rediscover it.

**This is a partial contract.** There is no `ENDPOINTS.yaml`, no `fixtures/` and no
`scripts/probe.sh` for Sleeper yet — the same state `contracts/api-sports/` started in. It was
created 2026-09-29 because the future-week projections build needed somewhere to record what the
committed code does NOT establish, and the root CLAUDE.md rule is to record an unknown rather than
probe for it. The only shape authority today is the code that already consumes the feed:
`lib/sports-data/sleeperMarketService.ts` (`getWeekBoard`, `WireRow`) and
`lib/tournament/resolveNflWeek.ts` (`state/nfl`).

**Status values:** `UNVERIFIED` (never probed) · `PROBE_PENDING` (queued for next capture) ·
`RESOLVED` (fixture committed) · `WONTFIX` (doesn't exist / not needed)

---

## Projections board — `api.sleeper.com/projections/nfl/{season}/{week}?season_type=regular&position[]=…`

Consumed by `getWeekBoard` (6h `SportsDataCache`), the current-week phase of
`/api/cron/import-projections`, and — from 2026-09-29 — its future-week phase
(`lib/projections/futureWeekIngest.ts`), which asks for the next 4 weeks.

| ID | Gap | Status | Blocks | How the code copes today |
|---|---|---|---|---|
| `S-01` | **How many weeks ahead does Sleeper publish projections?** | **MEASURED 2026-10-02: at least 4** | — | Production `future_week_projection_checks` with week 4 current: weeks 5, 6, 7 and 8 all `published`, 980–1,042 lines each, every line carrying a full component set (kickers and defenses their own keys). The phase's 4-week horizon is filled; nothing says whether Sleeper goes further. Rescored under generic PPR rules a week-5 line reproduces Sleeper's `pts_ppr` to a median 0.04 pts (current week: 0.05) — the future line is the current feed's `stats.stats` line, stored flat. Read by the waiver boards from 2026-10-02 (lib/core-app/waiverClaimWeek.ts). |
| `S-02` | **What does a week that is not yet projected return?** Candidates: `[]`; rows with `stats: {}`; rows with stats but no `pts_ppr`; a non-2xx. Unobserved for any week. | **UNVERIFIED** | Telling "not published" apart from "request failed" with certainty | `fetchRows` maps any non-2xx or throw to `null` → recorded as an **error** (last good lines kept). A 2xx whose rows carry no finite `pts_ppr` (covers the first three candidates) → **not_published**. If Sleeper actually answers an unprojected week with a non-2xx, it will show as a daily error rather than "not published" — visible in the cron's `futureWeeks` report, harmless to readers. |
| `S-03` | **Are future-week lines revised before the week arrives, and how often?** | **UNVERIFIED** | Nothing — informs cadence only | Change is detected by hashing the canonical board (`hashBoardLines`), never by status; an unchanged board only moves `confirmed_at`. `changed_at` vs `confirmed_at` in the checks table will show revision frequency. |
| `S-04` | **Does a future-week row's top-level `opponent` reflect a later flex-schedule change?** | **UNVERIFIED** | Nothing — the player card takes opponents from `SportsGame`, not from this feed | `opponent` is stored for reference only. |

## League settings — waiver schedule (`/league/{id}` → `settings`)

Stored raw since 2026-10-02 by `SleeperLeagueMapper` as `League.settings.sleeper_waiver_schedule`
(`waiver_day_of_week`, `daily_waivers`, `daily_waivers_hour`, `waiver_clear_days`). **Nothing
renders them.** The schedule the Waivers screens show is OBSERVED instead: every completed
transaction carries `status_updated`, now stored by `SleeperHistoricalTransactionSyncService` as
`dw_transaction_facts.payload.statusUpdatedAt`, and one league's claims in one run resolve together
— `lib/waivers/observedWaiverSchedule.ts` reads the league's schedule off those runs.

| ID | Gap | Status | Blocks | How the code copes today |
|---|---|---|---|---|
| `S-05` | **What does `waiver_day_of_week` count from?** Sunday = 0 (JS) or Monday = 0, or something else. | **UNRESOLVED — one value measured, the base not (2026-10-03)** | Rendering the setting as a weekday | Compared on production after the raw settings landed (474 of 476 real leagues; 249 also observed). **Measured: `2` = Wednesday** — of 28 leagues OBSERVED processing on one weekday and set to `2`, 26 run on Wednesday (17 of the 19 with `daily_waivers = 0` at 00:xx PT). **Not measured: the base.** Claim VOLUME cannot settle it: 63% of ALL leagues peak on Wednesday whatever they are set to (the NFL week), so the 249 leagues on `2` agree with any reading for free, and the off-default leagues point against the obvious one — 17 of 24 set to `1` still peak Wednesday, not Tuesday. Only ONE weekly-observed league is off-default (`1` → Thursday 19:xx PT), which no simple base predicts. `waiver_day_of_week` is read nowhere; `get_waiver_status` used to read it as Sunday = 0 (from a path the importer never writes) and no longer does. To resolve: more off-default WEEKLY leagues, compared by run day — not by claim volume. Re-run the comparison (2026-10-03 session) as leagues accumulate; do not probe. |
| `S-06` | **What timezone does Sleeper process waivers in — and is `daily_waivers_hour` that hour?** | **RESOLVED 2026-10-03 (measured): Pacific, and yes** | — | Pacific measured 2026-10-02 (5 leagues across PST and PDT: one Pacific hour, two UTC hours). Then, once the raw settings landed: `daily_waivers_hour` equals the observed Pacific run hour in **246 of 249** leagues, across ~20 distinct hours — not just the default 0. `daily_waivers = 1` → observed daily in 213 of 222; `0` → weekly in 20 of 27. Used by `lib/waivers/sleeperWaiverSchedule.ts`: a league nothing has been observed for, and Sleeper says runs daily, runs every day at that hour, Pacific. |
| `S-07` | **Is a completed waiver claim's `status_updated` the processing instant?** | **RESOLVED 2026-10-02 (measured): yes** | — | Same 237 claims, 5 leagues: the busiest Pacific weekday-hour held an average **31%** of a league's claims by `status_updated` against **12%** by `created`, and within a league resolutions land on the same minute (`00:05`, `09:06`, `20:05` PT). `created` is submission time; `status_updated` is the run. |
| `S-08` | **Is a Sleeper league's waiver processing weekly or daily?** | **MEASURED 2026-10-02: daily at a league-specific time** | — | Those 5 leagues each resolved claims at one fixed Pacific time on whichever days claims came due — the busiest weekday held ~3 of 10 runs. So the observer reads a schedule as DAILY unless one weekday holds 80% of the agreeing runs (`WEEKLY_SHARE`); the first version keyed on the busiest weekday and printed "Thursday 00:05" for a league that processes nightly. What the weekly `waiver_day_of_week` setting then controls (presumably when the post-game wave clears) is part of S-05. |
