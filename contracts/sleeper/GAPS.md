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
