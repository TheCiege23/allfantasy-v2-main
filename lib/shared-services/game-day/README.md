# Game Day / Scoring Service (Shadow Mode) — Phase 9

Game Day / Scoring OS foundation, Fantasy OS Migration Plan. Mirrors the shadow-mode discipline of [`trade`](../trade/README.md), [`waiver`](../waiver/README.md), and [`draft`](../draft/README.md) — but with one structural difference: **this module reuses real, already-live canonical engines directly** rather than reimplementing anything. The audit found ONE real matchup/scoring entry point and ONE real cross-league lineup-issue engine already doing most of this work, live, for real routes.

## What was audited first (4 parallel research passes)

### Matchup and scoring — one real entry point, not several competing ones
`server/services/matchupCenterService.ts`'s `buildMatchupCenterPayload()` is THE single real matchup/scoring entry point — it branches redraft-family (`RedraftMatchup`/`RedraftRoster`) vs generic (`TeamWeekResult`/`Roster`) internally, and already merges per-player scores via `canonicalPlayerScores.ts` (materialized `WeeklyScore` wins if present, else scored live via `lib/redraft/scoringEngine.ts`'s `calculateScoreFromSportConfig`). **This module reuses it directly — it does not recompute scores, projections, or matchup pairing.** Standings (`server/services/standingsEngine.ts`) and week-outcome resolution (`server/services/matchupEngine.ts`) are separate, real, authoritative engines this module reads through, not around.

Current-week resolution reuses `lib/chimmy-context/providers/_helpers/currentWeek.ts`'s `resolveCurrentWeek()` — a real, provider-neutral cascade (RedraftSeason → TeamWeekResult → WeeklyMatchup(Sleeper) → league settings → fallback) — instead of `matchupCenterService`'s own weaker settings-only fallback, so this module reports the most authoritative week available.

**Found but deliberately not wired**: a real Gaussian win-probability engine (`lib/matchup-prediction-engine/MatchupPredictionEngine.ts`) and playoff-odds/season-simulation engines (`lib/season-forecast/`, `lib/simulation-engine/`) exist for a separate "Simulation Lab" surface — not the live matchup center. `winProbabilityLeft` in this module's context comes from `matchupCenterService`'s own simple projected-points ratio, labeled honestly, not the Gaussian model.

### Lineup and roster — real reuse target found: `computeLineupActionsForUser`
`lib/lineup-actions/computeLineupActionsForUser.ts` is a real, live, **already cross-league** lineup-issue engine (branches native vs Sleeper internally via `scanNativeLeagueLineup`/`scanSleeperLeagueLineup`), already wired into Decision OS's lineup slice (`lib/decision-os/lineup/`, further along than trade/waiver's — it has an active route at `/api/today/lineup-actions` gated by `DECISION_OS_LINEUP_SHADOW`/`DECISION_OS_LINEUP_LIVE`) and covers illegal slots, empty/unsafe starters, and lock-window warnings. **This module's `LineupAttentionService.ts` reuses it directly as its primary source** — mapped into this module's own canonical shape — and adds only NEW reasons the existing engine doesn't cover (see below).

Two parallel lineup-SETTING/validation stacks were found (JSON-roster via `lib/roster-lineup-engine/`, and a separate relational redraft stack via `lib/redraft/lineupValidation.ts`) — this phase does not touch either; it only reads their downstream real data (`MatchupCenterPayload`, `LineupActionItem[]`).

### Player status and live data — real, layered, RI-primary
Two real live-data fallback orchestrators exist (`lib/sports-router.ts` and `lib/workers/api-chain.ts`), both with Rolling Insights as the PRIMARY source (not a fallback), cascading through API-Sports/ClearSports/TheSportsDB/Sleeper/ESPN. Real, confirmed-working weather integration (`lib/openweathermap.ts`, versioned via `AFProjectionSnapshot`). Real per-week-snapshotted projections (`FantasyProjection`) and actuals (`FantasyStatLine`) — both unique-per-week, never overwritten. This module does not call these directly — `matchupCenterService.ts` already surfaces their output (`injuryStatus`, `weatherSummary`, `currentPoints`, `projectedPoints`) per starter.

### Decision OS's lineup slice — the furthest-along shadow slice in the whole project
Unlike trade/waiver (shadow-only) and draft (no slice at all), Decision OS's lineup slice already has `automation_capable: true` and a live-flag-gated route. This module's `LineupAttentionService`/`GameDayDivergenceAnalyzer` treat it as a real sibling to compare against for injury-detection divergence (see below), not something to duplicate or migrate.

## Modules

- **`GameDayContextAssembler.ts`** — one league's context for one user, wrapping `buildMatchupCenterPayload` + `resolveCurrentWeek`.
- **`MatchupStateNormalizer.ts`** — pure; richer provider-neutral matchup state (adds `postponed`/`cancelled`/`bye`/`unsupported`/`stale`/`unavailable` to the real `upcoming`/`live`/`final`). Bye is detected via the real `right.rosterId === 'bye'` sentinel `matchupCenterService.ts` already uses — verified by reading its bye-branch construction, not guessed.
- **`UserPlayerExposureService.ts`** — genuinely new: per-user, cross-league player exposure (league/roster/starting/bench/IR-taxi counts + exposure %).
- **`LineupAttentionService.ts`** — reuses `computeLineupActionsForUser` as primary + adds new checks this phase's real data supports: ruled-out/inactive/questionable/doubtful starters (from `MatchupPlayerSlot.injuryStatus`), postponed/cancelled starter games (cross-referenced against real `FantasyScheduleGame.status`), missing projections, and stale-context flags.
- **`GameWindowService.ts`** — real day-part windows for NFL/NCAAF from `FantasyScheduleGame.kickoffTime`; single daily-slate window for other sports, matching the real granularity `lib/league/lineup-lock.ts`'s `dailySportLock()` already uses (no per-game precision invented for sports that don't have it).
- **`GameDayDivergenceAnalyzer.ts`** — see "Divergence" below.
- **`GameDaySnapshotService.ts`** / **`GameDaySnapshotStore.ts`** — orchestrates a full cross-league snapshot for a user; in-memory only (see "Persistence status").

## Private user exposure vs. Knowledge Graph exposure

`UserPlayerExposure` (this phase) is **not** the Fantasy Knowledge Graph's `PlayerExposure` (Phase 3, `lib/shared-services/knowledge-graph/PlayerExposureEngine.ts`). The KG aggregate answers "how exposed is the whole anonymized platform to this player" behind a 20-league cohort privacy gate. This service answers "how exposed is THIS ONE USER to this player across their own leagues" — it is the user's own private data, so the Phase 3 cohort gate is correctly **not** applied here, per the brief's explicit instruction. The two types are exported separately (`UserPlayerExposure` vs. the re-exported `KnowledgeGraphPlayerExposure`) and never mixed into one type or store.

## Divergence (shadow comparison)

Per the brief: *"Do not force a shadow comparison where no comparable existing engine exists."* This module does **not** invent a second scoring/projection engine to diverge against — the context assembler already reuses the one real canonical source directly, so there's nothing independent to compare scores or projections to (`score_mismatch`/`projection_mismatch`/`game_state_mismatch`/`freshness_mismatch`/`missing_roster`/`missing_player`/`starter_mismatch` are declared in the divergence category type for future use but never produced by this phase — documented, not silently omitted).

The one genuinely comparable pair: this service's own injury-status detection (from `MatchupPlayerSlot.injuryStatus`) versus `computeLineupActionsForUser`'s own, separately-coded native/Sleeper lineup-scan injury detection — two real, independent code paths that can genuinely disagree about the same player (`status_mismatch`, `alert_severity_mismatch`). `missing_league` is also real: both sources are supposed to cover the same user's connected leagues, so a gap is a legitimate finding.

## Known limitations

- `bench_out_projecting_starter` and `healthy_player_on_ir` are declared in `LineupAttentionReasonCode` but not computed — `MatchupCenterPayload` only exposes starters (not bench/IR with projections), so implementing them now would require guessing at data this phase doesn't have.
- Player-id resolution in exposure data comes straight from `Roster.playerData`'s own lineup-section ids — no cross-provider identity resolution beyond what Phase 1's identity service already established.
- `winProbabilityLeft` is `matchupCenterService`'s own simple ratio, not the real Gaussian `MatchupPredictionEngine` (a separate, real subsystem for a different surface) — labeled as such, not fabricated as more sophisticated than it is.

## Historical replay

Real point-in-time data genuinely exists for MATCHUP/SCORE/PROJECTION state: `TeamWeekResult`/`WeeklyScore` (per-week materialized), `FantasyProjection`/`FantasyStatLine` (unique per player/week/source, never overwritten), `AFProjectionSnapshot` (versioned weather-adjusted snapshots). Because `buildMatchupCenterPayload()` already accepts explicit `season`/`week` overrides and reads these real per-week tables, `GameDayContextAssembler.buildLeagueGameDayContext()` **already supports historical weeks for free** — no separate backtest module was built.

**What is NOT replayable, honestly**: lineup/roster state has no per-week snapshot (only `AfRosterMoveHistory`-style move events, not full weekly lineup snapshots) — calling this module for a past week reflects the CURRENT roster/lineup, not the lineup as it existed that week. Lineup-attention items for a historical week are therefore not meaningful and this module does not claim otherwise.

## Persistence status

`GameDaySnapshotStore` is in-memory only, same disclosed non-durable pattern as every prior phase's shadow store. A schema proposal for durable snapshots is documented separately (see `docs/os/GAME_DAY_SNAPSHOT_SCHEMA_PROPOSAL.md`) rather than an unapproved migration.

## What is NOT done in this phase

No consumer (dashboard, league matchup page, Game Day UI, Start/Sit UI, Matchup Prep, Injury Update, notifications, Chimmy, Commissioner OS, Decision OS routes, provider write actions, mobile views) is migrated or altered. No lineup writes occur. No live scoring behavior changed.
