# Scoring week resolution (Phase 7B)

**Related:** Stat pipelines and dual substrates — `docs/stat-substrate-ownership.md` (Phase 7C).

## Purpose

Automated scoring (`runScoringWorker` → `scoreLeagueWeek`) must use the **correct fantasy week** per league. Silent default to **week 1** caused trust issues (see Phase 7A audit).

## Source order (`resolveActiveWeekFromInputs`)

Applied in order; first match wins.

1. **Explicit** — `explicitWeekOrRound` (and optional `explicitSeason`) from the caller (cron query params, queue payload, API body).
2. **`RedraftSeason.currentWeek`** — latest season row for the league in `active`, `playoffs`, or `drafting` (warning if `drafting`).
3. **League settings** — JSON keys: `currentWeek`, `current_week`, `week`, `leg`, `round`, `activeWeek` (number or numeric string, clamped 1–40).
4. **NFL dominant fallback** — only when `league.sport === 'NFL'`: most common `currentWeek` among active/playoff **NFL** `RedraftSeason` rows (same idea as `import-scores`). Marked with **`warning: true`**.
5. **Unresolved** — returns `ok: false` with reason `active_week_unresolved`. **No scoring** for that league.

## Caller responsibilities

| Caller | Behavior |
|--------|----------|
| `runScoringWorker` | If **both** `season` and `weekOrRound` are valid, uses them for every league in the run (**batch explicit**). If only `weekOrRound` is set, uses each league’s `League.season` with that week. Otherwise calls **`resolveActiveWeekForLeague`** per league; **skips** with `scoring_skipped_unresolved_week` log if unresolved. |
| `runWeeklyLeagueAutomation` | Forwards optional `season` / `weekOrRound` / `jobName`; artifacts only for `kind === 'scored'` results. |
| `GET /api/cron/weekly-engine` | Optional `?season=` and `?week=` passed through (auth unchanged). |
| `POST /api/redraft/score-sync` | Uses `jobName: api/redraft/score-sync`; survivor bridge uses resolver per league (skipped vs synced counts). |
| `POST .../scoring/process-week` | Body **`week`** optional; if omitted, resolver runs; **422** if unresolved. |
| Queue `standings_refresh` | If payload missing valid week/season pair, **`resolveActiveWeekForLeague`** fills gaps; throws if still unresolved. |
| Queue `scoring_week` | Still requires both in payload (unchanged). |

## Observability (stdout JSON)

Emitted via `logLeagueEngineEvent` / `console`:

- `active_week_resolved` / `active_week_unresolved` — from `resolveActiveWeekForLeague`.
- `scoring_job_started` / `scoring_job_completed` — batch metadata from `runScoringWorker`.
- `scoring_skipped_unresolved_week` — league skipped, no `scoreLeagueWeek` call.
- `scoring_league_completed` — per league after a successful score.
- `score_lock_week_resolved` — redraft score-lock cron.
- `update_matchup_scores_started` — redraft matchup recompute (week from matchup row).

Payload fields (no PII): `jobName`, `leagueId`, `resolvedWeek`, `season`, `source`, `warning`, counts.

## Future work

- Align **`PlayerGameStat`** vs **`PlayerWeeklyScore`** ingestion (Phase 7A) — separate from week resolution.
- Optional calendar-based week for non-redraft sports without dominant NFL signal.
