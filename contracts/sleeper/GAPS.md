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
| `S-01` | **How many weeks ahead does Sleeper publish projections?** The only evidence on record is indirect: the importer's old date guess ran one week ahead and still wrote real lines from each Tuesday (measured on production 2026-09-24, see `approximateCurrentWeek` in the cron route), so week N+1 is populated at least from the Tuesday of week N. Nothing establishes N+2 … N+4. | **UNVERIFIED** | Knowing whether a 4-week horizon is ever filled beyond N+1 | The phase asks for all four every day and records each week's answer in `future_week_projection_checks`; an unpublished week is `not_published`, rendered "not published yet". After a few days of cron runs the table itself answers this — read `status` by `week - anchor_week`, no probe needed. |
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
| `S-05` | **What does `waiver_day_of_week` count from?** Sunday = 0 (JS) or Monday = 0, or something else. `lib/chimmy/tools/waiverStatusTool.ts` already ASSUMES Sunday = 0, against a field no import ever stored (measured 2026-09-24, `lib/chimmy-alerts/waiverCheck.ts`). | **UNVERIFIED** | Rendering the setting directly | Not rendered. ⚠ **Resolve by comparison, not by probe:** once leagues hold both the raw value and an observed schedule, `waiver_day_of_week` against the observed weekday (Pacific) across leagues settles the base. Then fix or confirm `waiverStatusTool`. |
| `S-06` | **What timezone does Sleeper process waivers in?** | **RESOLVED 2026-10-02 (measured): Pacific** | — | Measured on the full-data DB after backfilling `statusUpdatedAt` for 5 leagues (claims Jan–Sep 2026, so both PST and PDT): every league's runs sat at ONE Pacific hour while the UTC hour took two values a DST shift apart (e.g. PT 00 ↔ UTC 07/08). `OBSERVED_TIME_ZONE` = Pacific is confirmed, not assumed. Still open: whether `daily_waivers_hour` is that same Pacific hour — compare per league once stamped leagues carry the raw settings. |
| `S-07` | **Is a completed waiver claim's `status_updated` the processing instant?** | **RESOLVED 2026-10-02 (measured): yes** | — | Same 237 claims, 5 leagues: the busiest Pacific weekday-hour held an average **31%** of a league's claims by `status_updated` against **12%** by `created`, and within a league resolutions land on the same minute (`00:05`, `09:06`, `20:05` PT). `created` is submission time; `status_updated` is the run. |
| `S-08` | **Is a Sleeper league's waiver processing weekly or daily?** | **MEASURED 2026-10-02: daily at a league-specific time** | — | Those 5 leagues each resolved claims at one fixed Pacific time on whichever days claims came due — the busiest weekday held ~3 of 10 runs. So the observer reads a schedule as DAILY unless one weekday holds 80% of the agreeing runs (`WEEKLY_SHARE`); the first version keyed on the busiest weekday and printed "Thursday 00:05" for a league that processes nightly. What the weekly `waiver_day_of_week` setting then controls (presumably when the post-game wave clears) is part of S-05. |
