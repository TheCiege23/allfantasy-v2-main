# Phase 7A — League Gameplay Lifecycle Audit

**Scope:** Audit + stabilization planning only. No shell redesign, no new gameplay systems, no scoring-architecture rewrite, no realtime migration.

**Date:** 2026-05-11  
**Systems reviewed:** Matchups, weekly scores, standings, lineup/roster saves, waivers (AF + redraft), transactions, crons, stat ingestion, notifications, commissioner paths, Prisma models, key `lib/` and `app/api/` surfaces.

---

## 1. Systems audited (inventory)

| Area | Primary locations |
|------|-------------------|
| **Generic league scoring (multi-sport)** | `lib/scoring/scoring-engine.ts` (`scoreLeagueWeek`), `lib/multi-sport/MultiSportMatchupScoringService.ts`, `lib/workers/scoring-worker.ts` |
| **Weekly league processing (detailed)** | `server/services/weeklyProcessor.ts` (`processLeagueWeek`), `app/api/leagues/[leagueId]/scoring/process-week/route.ts`, `lib/scoring-defaults/queueLeagueScoringRecalc.ts` |
| **Redraft H2H matchups** | `lib/redraft/scoringEngine.ts` (`updateMatchupScores`), `prisma` `RedraftMatchup`, `RedraftRoster`, `RedraftSeason` |
| **Redraft standings / lock** | `lib/redraft/standingsEngine.ts`, `app/api/cron/score-lock/route.ts`, `lib/redraft/playoffEngine.ts` (advance winners) |
| **Stat ingestion (NFL API-Sports path)** | `app/api/cron/import-scores/route.ts`, `lib/schedule-stats/StatIngestionService.ts`, `PlayerGameStat` |
| **Redraft / survivor / zombie score sync** | `app/api/redraft/score-sync/route.ts` |
| **Waivers (AF engine)** | `lib/waiver-wire/process-engine.ts`, `app/api/cron/waivers/route.ts`, `lib/automation/jobs/waivers/*`, `WaiverClaim`, `WaiverRun` |
| **Waivers (redraft)** | `lib/redraft/waiverEngine.ts`, `RedraftWaiverClaim`, `app/api/cron/waiver-processing/route.ts`, `app/api/redraft/waiver-process/route.ts` |
| **Lineup / roster persistence** | `app/api/leagues/roster/save/route.ts`, `lib/roster-lineup-engine/lineupService.ts`, `lineupLockService`, roster validation |
| **Commissioner overrides** | `app/api/commissioner/leagues/[leagueId]/lineup/route.ts`, scoring recalc queue, trade/waiver commissioner APIs (partial review) |
| **Sleeper import scores** | `lib/league/sleeper-import-process.ts` (`TeamPerformance` upserts from Sleeper matchups) |
| **Observability** | `lib/league-engine-performance/observability.ts`, idempotency keys for waiver cron |
| **Notifications / hints** | `lib/league-notifications/realtimeHint.ts` (e.g. roster save), broader notification stack not exhaustively mapped |
| **Matchup simulation (product)** | `lib/simulation-engine/*`, `lib/ai/sim/matchupSimulator.ts` (deterministic/AI layers — separate from live league truth) |

---

## 2. Current architecture (conceptual map)

### 2.1 Source of truth (fragmented by product path)

- **`League` + `Roster.playerData` (JSON)** — canonical lineup and roster slots for most AF-native flows; lineup lock derived from `league.settings` + `lineupLockService`.
- **`TeamPerformance` + `LeagueTeam`** — updated by `scoreLeagueWeek` from **`PlayerGameStat`** (week keyed).
- **`WeeklyScore` / `TeamWeekResult`** — produced by `processLeagueWeek` from **`PlayerWeeklyScore`** reads (different stat table than `PlayerGameStat` for the pipeline body).
- **`RedraftMatchup` + `RedraftRoster`** — H2H scores on matchups; season standings on rosters recomputed from **final** `RedraftMatchup` rows via `updateStandings`.
- **Imported Sleeper leagues** — `TeamPerformance` can also be fed from Sleeper API during import (`sleeper-import-process.ts`), potentially overlapping conceptually with AF-native scoring.

**Implication:** There is no single “gameplay ledger” document or module that owns end-to-end truth for all league types; different verticals (redraft vs generic vs Sleeper import) converge on overlapping tables with different writers.

### 2.2 Scheduled jobs (high level)

| Job | Schedule (vercel.json) | Role |
|-----|-------------------------|------|
| `/api/cron/import-scores` | Every 2 min (NFL) | Ingest player stats → `PlayerGameStat` |
| `/api/redraft/score-sync` | Every 5 min | Orchestrates `runScoringWorker`, survivor bridge, zombie resolution, C2C matchup updates |
| `/api/cron/weekly-engine` | Monday 09:00 | `runWeeklyLeagueAutomation` (scoring worker + artifacts + keeper/cutdown hooks) |
| `/api/cron/score-lock` | Tuesday 07:00 | Finalize redraft matchups, `updateStandings`, playoff advance, bump `RedraftSeason.currentWeek` |
| `/api/cron/waiver-processing` | Wednesday 10:00 | `processWaiverWindow` / `resetWaiverPriority` for **active redraft seasons** |
| `/api/cron/waivers` | Every 5 min | Due-league discovery → `processWaiverClaimsForLeague` (**`WaiverClaim`** model) |
| `/api/redraft/waiver-process` | Hourly | Additional redraft waiver processing window (subset of seasons) |

### 2.3 Scoring update flow (simplified)

1. **NFL stats → DB:** `import-scores` → `ingestSportStats` → `PlayerGameStat`.
2. **All leagues loop:** `runScoringWorker()` loads **all** `League` rows and calls `scoreLeagueWeek` with a resolved `(season, weekOrRound)`.
3. **`scoreLeagueWeek`:** For each roster, compute points via `computeRosterScoreForWeek` (starters / best-ball path), upsert `TeamPerformance`, then re-rank **`LeagueTeam`** by summing **all** `TeamPerformance` rows for those teams, write `pointsFor` + `currentRank`, optionally `ScoringSettingsSnapshot`, optional `settings.score_lock` when locking.

**Parallel path:** `processLeagueWeek` rebuilds `WeeklyScore` / `TeamWeekResult` / matchup outcomes from **`PlayerWeeklyScore`** — used on commissioner/API-driven processing, not the same cron entry as `weekly-engine` unless wired separately.

**Redraft path:** `updateMatchupScores` sums starters using **`PlayerWeeklyScore.fantasyPts`** (or devy engine), writes `RedraftMatchup.homeScore` / `awayScore`.

### 2.4 Standings update flow

- **Redraft:** `updateStandings(seasonId, week)` — idempotent full recompute from **final** matchups ≤ week; bulk `RedraftRoster` updates inside a transaction.
- **Generic `LeagueTeam`:** Updated inside **`scoreLeagueWeek`** as global PF ranking from all `TeamPerformance` rows (not the same semantics as redraft W/L).

### 2.5 Waiver processing flow

- **AF `WaiverClaim`:** Ordering rules in `process-engine.ts`; idempotency via `WaiverRun.metadata.idempotencyKey`; processing lock via `getLeagueWaiverState`; cron `/api/cron/waivers` uses `discoverDueWaiverLeagues` + `processLeagueWaiversJob`.
- **Redraft `RedraftWaiverClaim`:** `processWaiverWindow` in `lib/redraft/waiverEngine.ts`; scheduled `/api/cron/waiver-processing` and `/api/redraft/waiver-process`.

### 2.6 Transaction persistence

- **Waivers:** `WaiverTransaction` + claim status transitions in process engine; redraft uses redraft-specific tables (`RedraftLeagueTrade`, etc. — not fully traced in this pass).
- **Roster moves:** `recordAfRosterMoveHistory` after lineup persistence; `syncAfRosterLineupAssignments` in the same transaction as roster `playerData` update.

### 2.7 Lineup save flow

`POST /api/leagues/roster/save` → eligibility (commissioner vs member, chopped roster, specialty `rosterGuard`) → `persistRosterLineupWithEngine` → validation → **lock check** (`resolveFullLineupLockContext`) → **transaction:** `roster.update` + `syncAfRosterLineupAssignments` → **post-commit** move history + lock state upsert + realtime hint + cache invalidation hooks.

---

## 3. Trust risks (prioritized)

### P0 — Week / season resolution for automated scoring

- **`runScoringWorker` / `resolveSeasonWeek`:** When called with no `weekOrRound`, defaults to **`weekOrRound: 1`** and calendar `season` (`lib/workers/scoring-worker.ts`). **`/api/redraft/score-sync`** and **`/api/cron/weekly-engine`** invoke this path **without** passing the active NFL week from `RedraftSeason.currentWeek` or league settings.
- **Effect:** Automated `TeamPerformance` / `LeagueTeam` updates may repeatedly target **week 1** while `import-scores` ingests the **live** NFL week into `PlayerGameStat`. Live matchup truth for redraft (`RedraftMatchup`) depends on **`PlayerWeeklyScore`**, which is **not** the same ingestion path as `import-scores` (see `redraft/score-sync` comments: separate legacy path).
- **Risk class:** Stale or wrong-week scores on dashboards; standings drift; user distrust (“scores did not update after games”).

### P1 — Dual stat substrates (`PlayerGameStat` vs `PlayerWeeklyScore`)

- Multi-sport weekly scoring for `scoreLeagueWeek` reads **`PlayerGameStat`**.
- Redraft matchup scoring reads **`PlayerWeeklyScore`**.
- **`processLeagueWeek`** reads **`PlayerWeeklyScore`** for detailed weekly rows.
- **Risk:** Ingestion or correction in one store does not guarantee the other updates; operators may not know which job fixes which UI.

### P1 — Dual waiver systems

- **`WaiverClaim`** + AF engine vs **`RedraftWaiverClaim`** + redraft engine, different crons.
- **Risk:** Commissioner configures one mental model; processing uses another table; double-runs or “nothing happened” if league type and cron coverage diverge.

### P2 — `scoreLeagueWeek` → `LeagueTeam` aggregation semantics

- `LeagueTeam.pointsFor` / `currentRank` are recomputed from **all** historical `TeamPerformance` rows for the team, each time a single week is scored.
- **Risk:** Semantically surprising if product intent is “weekly PF only” or H2H-specific; coupling every cron tick to full history increases DB read cost as seasons grow.

### P2 — Cron runtime ceilings

- Several gameplay crons use **`maxDuration` 60s** (`weekly-engine`, `score-lock`, `waiver-processing`, `redraft/score-sync`). At scale (many leagues per run), partial completion without visible operator recovery is a risk.

### P2 — Placeholder / incomplete live-lock bridge

- `lockPlayersAtGameStart` in `lib/redraft/scoringEngine.ts` is explicitly a **placeholder** (no provider wiring).

### P3 — Sleeper vs AF-native score overlap

- Sleeper import writes `TeamPerformance`; AF scoring also writes `TeamPerformance`. Same table, multiple writers — last writer wins per upsert key; needs clear policy per league `platform`.

### P3 — Notification drift

- Roster save publishes a realtime **hint**; full “your matchup score changed” or “waiver processed” coverage not verified end-to-end in this audit.

---

## 4. User experience risks

| Risk | Notes |
|------|------|
| **Scoring freshness unclear** | Without a single “last computed at / data source” banner per tab, users cannot tell `PlayerGameStat` vs `PlayerWeeklyScore` vs Sleeper sync. |
| **Lineup lock opacity** | Lock logic is real (`lineupService` + `resolveFullLineupLockContext`) but UX may not surface *why* locked (rule vs game start vs commissioner). |
| **Waiver state confusion** | Pending vs failed vs processed with `outcomeCode` in metadata — powerful for support, easy to under-explain in UI. |
| **Two waiver schedules** | `/api/cron/waivers` every 5 minutes vs Wednesday batch redraft job — different expectations. |
| **Transaction visibility** | History depends on which engine populated rows; partial views if only one pipeline ran. |
| **Matchups tab empty / dead** | If `RedraftMatchup` not generated or scores never updated, tab can look broken while roster tab works. |
| **Activity cues** | League activity feed breadth not audited here; risk of “silent” week if notifications not wired to all engine events. |

---

## 5. Production risks

| Category | Detail |
|----------|--------|
| **Scaling** | `runScoringWorker` without `leagueIds` iterates **every** league; O(leagues × rosters × players) DB reads per tick. |
| **Polling** | `import-scores` every 2 min + `score-sync` every 5 min multiplies API-Sports / DB load. |
| **Cron coupling** | Redraft week advance depends on **`score-lock`** ordering; generic scoring depends on **`import-scores`** + **`score-sync`** — failure masking (try/catch with continue) can leave silent partial state. |
| **Retries / idempotency** | Waiver engine: idempotency keys for cron; redraft waiver window: verify same guarantees per league. |
| **Observability** | `logLeagueEngineEvent` exists for waiver/scoring batch — extend consistently to `processLeagueWeek`, `updateMatchupScores`, and cron partial failures. |
| **Admin recovery** | Manual `process-week` API and `score-lock` query overrides (`?season=&week=`) exist for redraft lock path; document runbooks for wrong-week scoring recovery. |

---

## 6. What is already strong

- **Lineup persistence pipeline:** Validation + lock resolution + transactional write + assignment sync + move history + lock cache upsert — **production-grade shape** (`lib/roster-lineup-engine/lineupService.ts`).
- **Waiver process engine (AF):** Clear ordering for FAAB / rolling / FCFS; explicit failure `outcomeCode`s; optional idempotency for cron; processing lock guard (`process-engine.ts`).
- **Redraft standings recompute:** Documented idempotent full rebuild from finalized matchups (`standingsEngine.ts`).
- **Operator docs / QA:** `docs/waiver-wire-qa-checklist.md`, `docs/qa-fantasy-core-final-checklist.md` — good contracts for manual verification.
- **Engine observability primitives:** `lib/league-engine-performance/observability.ts` subsystems list suitable for expansion.
- **Cron route documentation:** Several `app/api/cron/*/route.ts` files include schedule comments tying to `vercel.json`.

---

## 7. Recommended stabilization roadmap

| Order | Item | Complexity | Depends on | Rationale |
|-------|------|------------|--------------|-----------|
| **1** | **Single “active week” resolver”** shared by `runScoringWorker`, `weekly-engine`, and `redraft/score-sync` (per league: redraft season week → else `settings.currentWeek` / `leg` → else explicit override) | **M** | None | Fixes P0 trust; unlocks consistent UI timestamps. |
| **2** | **Stat pipeline matrix doc + ownership** (`PlayerGameStat` vs `PlayerWeeklyScore` writers and readers table) | **S** | #1 | Reduces operator confusion; guides ingestion fixes. |
| **3** | **Unify or bridge weekly stats** (longer-term; design only in 7A) — one write path feeding both consumers or explicit ETL | **L** | #2 | Eliminates P1 dual-substrate drift. |
| **4** | **Waiver system selector** — one routing layer: “this league uses RedraftWaiverClaim vs WaiverClaim” with tests | **M** | #2 | Prevents double-processing and wrong cron expectations. |
| **5** | **Cron observability + alerts** — structured logs include `leagueId`, `week`, `rowsUpdated`, `durationMs`; alert on zero rows when N games final | **S** | #1 | Faster incident detection. |
| **6** | **`LeagueTeam` ranking semantics** — product decision + possible migration to weekly-only or H2H-aware | **M–L** | #1, #3 | Avoid misleading standings. |
| **7** | **Wire or remove `lockPlayersAtGameStart`** | **M** | Provider contracts | Completes live lineup trust story. |

**Complexity key:** S = small (days), M = medium (1–2 weeks team-time), L = multi-sprint.

---

## 8. Estimated closed-alpha gameplay readiness

| Dimension | Assessment |
|---------|------------|
| **Draft / predraft** | Strong (per product status). |
| **Lineup save / lock enforcement** | **Strong** for AF-native path. |
| **Live scoring trust** | **At risk** until active week + stat substrate alignment is fixed and visibly confirmed in UI. |
| **Waivers** | **Good engine quality**, **moderate integration risk** due to dual systems and schedule multiplicity. |
| **Redraft H2H + standings** | **Solid logic** for finalized weeks; depends on matchup score feed staying fresh. |
| **Overall closed-alpha gameplay** | **Conditional:** acceptable for **controlled** leagues with manual commissioner verification of scores/week; **not** broadly production-ready across all formats until P0/P1 items are addressed and instrumented. |

---

## 9. Phase 7B — Implemented (active week resolver)

See **`docs/scoring-week-resolution.md`** for source order, caller wiring, and observability.

- **`lib/scoring/active-week-resolver.ts`** — `resolveActiveWeekForLeague`, `resolveActiveWeekFromInputs`, NFL dominant fallback, structured logs.
- **`lib/workers/scoring-worker.ts`** — per-league resolution when week not batch-specified; `scoredLeagues` / `skippedLeagues`; no silent week 1.
- **Callers wired:** `weekly-engine` (query params), `redraft/score-sync`, `process-week` API, queue `standings_refresh`, `updateMatchupScores` logging, `score-lock` week log.

---

## 9b. Phase 7C — Stat substrate ownership (architecture only)

See **`docs/stat-substrate-ownership.md`** for the `PlayerGameStat` vs `PlayerWeeklyScore` inventory, source-of-truth matrix, reconciliation risks, observability plan, and evolutionary migration roadmap. No merge of stat systems in 7C.

---

## 10. Validation performed

- **Static audit** via repository search and file reads (no full `tsc`, no repo-wide ESLint).  
- **Phase 7B:** targeted Vitest `__tests__/active-week-resolver.test.ts`; targeted ESLint on touched TS; `npm run build` after runtime changes.

---

## Appendix — Key file references

- `lib/scoring/active-week-resolver.ts` — week resolution + logs
- `lib/workers/scoring-worker.ts` — `runScoringWorker`, `runWeeklyLeagueAutomation`, `runWaiverProcessingWorker`
- `lib/scoring/scoring-engine.ts` — `scoreLeagueWeek`
- `app/api/redraft/score-sync/route.ts` — cron orchestration
- `app/api/cron/weekly-engine/route.ts`, `app/api/cron/score-lock/route.ts`, `app/api/cron/import-scores/route.ts`, `app/api/cron/waiver-processing/route.ts`, `app/api/cron/waivers/route.ts`
- `lib/redraft/scoringEngine.ts`, `lib/redraft/standingsEngine.ts`, `lib/redraft/waiverEngine.ts`
- `lib/waiver-wire/process-engine.ts`
- `lib/roster-lineup-engine/lineupService.ts`, `app/api/leagues/roster/save/route.ts`
- `server/services/weeklyProcessor.ts`
- `vercel.json` — schedule source of truth
