# G11 — Production Live Scoring Engine & Live Fantasy Experience

**Date:** 2026-06-26
**Goal:** A production-quality live scoring experience matching/exceeding ESPN,
Yahoo, Sleeper, Fantrax — delivered as a **reusable platform service** every league
concept (Redraft, Keeper, Dynasty, Best Ball, Guillotine, Survivor, Big Brother,
Devy, C2C, Zombie, Tournament, IDP) inherits. Not redraft-only.

**Status:** Phases 1–4 complete — engine core, store/source unification, live
orchestrator + provider + 30s worker, and all four live UI surfaces, with engine tests
+ staging E2E + a **green browser proof (Phase 4F)**. Per the readiness rule (proof
required), **NFL raised 92 → 93 / Overall 88 → 90**. Phases 5–7 (live quarter/clock
game-state, perf, deeper testing) remain below; the production 30s worker still needs
deployment.

---

## Phase 1 — Audit of the current implementation

| # | Capability | Current state | Verdict vs Sleeper/ESPN/Yahoo/Fantrax |
|---|---|---|---|
| 1 | Live stat ingestion | Sleeper weekly stats (`teamDefenseProvider`, player game logs) written to `PlayerWeeklyScore`/`player_game_log_cache`; DST via `syncNflTeamDefenseBoxScores` | Source is real & weekly, but pulled on a **5-min cron**, not a live loop |
| 2 | Live game polling | **None at 30s.** `runRedraftSeasonScoring` runs on the Vercel cron `*/5 * * * *`; Vercel cron cannot do 30s | **Gap** — competitors poll ~30s while live |
| 3 | Stat corrections | Idempotent upsert of weekly scores; no explicit correction *diff* path | Partial — corrections land on next full sync, not detected/broadcast |
| 4 | Live projections | `resolveProjectedPoints = max(currentPoints, staticPositionAverage)` in `matchupCenterService` | **Gap** — not pace/clock-aware (no rest-of-game model) |
| 5 | Live standings | `updateStandings` recomputed every cron tick (full) | Works, but recomputed wholesale every run |
| 6 | Matchup recalculation | `recalculateMatchupsForSeasonWeek` every cron tick (all matchups) | Works, but **not incremental** |
| 7 | Player score recalc | `syncPlayerWeeklyScoresForRedraftSeason` rescelps all rostered players every tick | **Rescore-everything** (Phase 6 concern) |
| 8 | Team score recalc | Summed in matchup recalc / matchup-center aggregation | OK |
| 9 | League refresh cadence | Server: 5-min cron. Client: `matchup-center` returns `refreshIntervalMs` (live 30s / upcoming 2m / final 0) + SSE `/api/redraft/stream` `score_update` | Client cadence good; **server data is only 5-min fresh** |
| 10 | Browser refresh strategy | `MatchupTabContainer` polls on `refreshIntervalMs`; `useLeagueRealtimeRefresh`/`useRedraftStream` (SSE) dispatch refresh events | Solid foundation; no animated score transitions / live event feed yet |

### Cross-cutting problems found
- **Two score tables / disconnect.** The live matchup surface (`matchupCenterService` →
  `MatchupTabContainer`) reads `WeeklyScore`, while the redraft engine writes
  `PlayerWeeklyScore`. The live UI and the scoring engine are not reading the same
  store (this also explains the G8 finding that seeded redraft scores didn't appear on
  the matchups tab). **High-value unification target.**
- **Naive win probability.** `winProbabilityLeft = projA / (projA + projB)` — ignores
  current score, points remaining, and variance. Competitors use variance/Monte-Carlo.
- **Naive projections.** Static position fallback, not clock/pace-aware (#4).
- **No real game-state granularity.** `SportsGame` has `status/homeScore/awayScore/
  startTime` but **no quarter/clock/period/OT columns** — Phase 3 player rows (Q1–Q4/
  OT/clock/live NFL score) need richer game state (schema extension or `raw` parsing +
  a provider that supplies it).
- **Rescore-everything.** No incremental planning — every cron tick rescores all
  players/matchups/standings for all active seasons (Phase 6).
- **No live scoring-event feed** (+1 Reception, +6 TD, timestamps) — not modeled.
- **Vercel-cron-only cadence.** 30s polling requires an external worker / scheduled
  loop; Vercel cron min granularity is 1 min (and we run 5).

---

## Phase 2 — Live scoring engine core (BUILT, reusable, tested)

New platform module `lib/live-scoring/` — **pure, deterministic, sport- and
concept-agnostic** (no Prisma/Next imports). This is the keystone every concept and
surface shares so cadence/projection/win-prob/rescore behave identically everywhere.

| Module | Responsibility | Replaces / fixes |
|---|---|---|
| `cadence.ts` | `resolvePollCadence(games, now)` → poll 30s while live, 30s on imminent kickoff, 2m upcoming, slow heartbeat for suspended, **stop on all-final**; `normalizeLiveGameStatus` maps any provider's raw status (incl. OT/halftime/suspended/postponed) to canonical | Hardcoded 5-min cron; no "only poll active games / stop on final" |
| `projection.ts` | `projectLivePlayerFinal({preGameProjection, currentPoints, status, fractionElapsed})` → rest-of-game model: `current + preGameProj × fractionRemaining`, current-as-floor, OT slice | Naive `max(current, positionAverage)` |
| `winProbability.ts` | `estimateWinProbability(sideA, sideB)` → normal-approximation on projected finals with variance that collapses as the game ends; deterministic once nothing remains; symmetric | Naive projection-ratio |
| `rescorePlan.ts` | `planIncrementalRescore({changedPlayerIds, rosters, matchups})` → only affected rosters/matchups; standings only when a **final** matchup is affected; `diffChangedPlayers` makes an unchanged poll a no-op | Rescore-everything (Phase 6) |

Tests: `__tests__/live-scoring/live-scoring-engine.test.ts` — **24 deterministic
tests** covering status normalization, all cadence branches (live/halftime/OT/
imminent/upcoming/final/postponed/suspended/empty), pace projection (scheduled/final/
mid-game/outperforming/OT), win probability (deterministic endgame, ~50% on ties,
clamped blowout, symmetry), incremental rescore (starter hit, bench no-op, standings
on final, empty), and stat-diff idempotency. Typecheck clean.

These directly satisfy the engine requirements: **idempotent** (`diffChangedPlayers`
→ no-op on unchanged polls), **incremental** (`planIncrementalRescore`), and
**deterministic** (pure functions, fixed-form normal CDF).

---

## Phase 2b — Score-store unification (BUILT)

### Audit decision
Two stores, two orchestrators:

| Store | Scope | Written by | Read by |
|---|---|---|---|
| `PlayerWeeklyScore` | **global** raw stat line per `(playerId, week, season, sport)` | redraft sync (`playerWeeklyScoreService`) + providers | **every concept** — redraft, bestball, c2c, devy, guillotine, survivor, keeper, roster route |
| `WeeklyScore` | **per-league/roster** computed points `(leagueId, season, week, rosterId, playerId)` | only `weeklyProcessor.processLeagueWeek` (generic; handles all modes, best-ball, **stat corrections** via `statCorrectionService`, history) | matchup-center, matchup engine, chimmy, bestball/scoring-breakdown routes |

The disconnect: the **matchup-center sources scores (`WeeklyScore`) AND opponent pairing
(`TeamWeekResult`) + rosters (`Roster`) from the generic `weeklyProcessor` model**, which
**no cron or the redraft pipeline populates** (`weeklyProcessor` only runs on manual
`/scoring/process-week`, a scoring-rules change, or a stat correction). The redraft pipeline
writes `PlayerWeeklyScore` + `RedraftMatchup` instead. So for a normal redraft league the
matchup-center sees no scores (and no pairing).

`WeeklyScore` is **not legacy** — it is the materialized, concept-agnostic computed-points
store with the only stat-correction path. So neither table is removed.

**Chosen strategy: Option C — a reusable, read-only score adapter** (lowest risk, zero
migration, no write-path changes, no conflicting totals). `PlayerWeeklyScore` stays the
canonical raw-stats source; `WeeklyScore` stays the canonical *materialized* per-league
result. The adapter normalizes both behind one shape with a single precedence rule.

### Precedence rule (the one rule when both exist)
1. **materialized** `WeeklyScore` wins — committed per-league result (carries stat
   corrections, best-ball optimization, historical finals).
2. else **computed** from the raw `PlayerWeeklyScore` stat line via the league's
   *injected* concept scorer.
3. else **none** (0 / null).

### Implementation
- `lib/live-scoring/playerScoreReadAdapter.ts` — **pure** `mergeCanonicalPlayerScores`
  (precedence merge; no DB; no duplicated math — materialized reused as-is, raw scored by
  the injected `scoreFromStats`). Part of the reusable engine core.
- `server/services/canonicalPlayerScores.ts` — DB binding `loadCanonicalPlayerScores`
  (loads both tables, calls the pure merger). Default scorer = `sportConfigStatScorer`
  (`calculateScoreFromSportConfig` — the exact redraft engine/roster path incl. the R1 DST
  bridge), so totals can never conflict. Other concepts inject their own scorer.
- `server/services/matchupCenterService.ts` — per-player score reads now go through
  `loadCanonicalPlayerScores` instead of a raw `WeeklyScore` query, so the matchup-center
  reads real engine scores (computed from `PlayerWeeklyScore` for redraft; materialized
  `WeeklyScore` for generic/corrected leagues).
- **Team/roster page** already reads the canonical path (`PlayerWeeklyScore` +
  `calculateScoreFromSportConfig` in the redraft roster route) — no change needed; the
  adapter makes the matchup-center consistent with it.

Tests: `__tests__/live-scoring/player-score-read-adapter.test.ts` — **7 deterministic
tests**: raw `PlayerWeeklyScore` row flows into the payload, materialized wins (and the
scorer is **not** re-invoked → no duplicated math), DEF (`nfl:def:KC`) scores+line flow,
stat correction wins, `none` fallback, idempotency, rounding. Typecheck clean on new files.

### Documented next step (pairing) — required before matchup-center fully renders redraft
The score read is unified, but matchup-center still resolves the **opponent pairing**
(`TeamWeekResult`) and **rosters** (`Roster`) from the generic model. For redraft leagues
those come from `RedraftMatchup` / `RedraftRoster`. The next increment is a reusable
**matchup-source adapter** that resolves pairing + lineups per concept (redraft →
`RedraftMatchup`/`RedraftRoster`, mapping `RedraftRoster`↔generic `Roster` by owner),
landed with staging + browser proof. This was deliberately deferred to avoid a risky
pairing rewrite (per the no-conflicting-pairings rule).

## Phase 2c — Matchup-source pairing adapter (BUILT)

### Problem
After Phase 2b the *score read* was unified, but `matchupCenterService` still sourced
**opponent pairing** (`TeamWeekResult`) and **rosters** (generic `Roster`) from the
`weeklyProcessor` model — which the redraft pipeline never populates. The redraft
engine uses `RedraftMatchup` / `RedraftRoster` / `RedraftRosterPlayer`. So a redraft
matchup-center returned a bye/empty even though the score adapter worked.

### Design — a reusable matchup-source boundary
A concept-pluggable seam that resolves *where a matchup's pairing + rosters come
from*, then the matchup-center applies the SHARED scoring (Phase 2b adapter) + media
+ payload assembly. No redraft-only hack; future concepts add their own source.

- `server/services/matchupSources/types.ts` — `MatchupSideContext` (rosterId,
  teamName, record, starters, weekStatus, `engineTotalPoints`) +
  `MatchupContextResult` (`matchup` | `bye` | `none{reason}`).
- `server/services/matchupSources/redraftMatchupSource.ts` —
  `resolveRedraftMatchupContext` resolves the viewer's `RedraftRoster` by `ownerId`,
  finds the `RedraftMatchup` for the week, and builds both sides from
  `RedraftRosterPlayer` (starters filtered by `isScoringStarterSlot`, DEF names via
  `safeTeamDefenseDisplayName`), with the engine total from the persisted
  `RedraftMatchup.homeScore/awayScore`. Returns `null` for non-redraft leagues.
  Pure cores `selectRedraftMatchupContext` / `buildRedraftSideContext` /
  `normalizeRedraftWeekStatus` are exported for deterministic tests.
- `server/services/matchupCenterService.ts` — refactored to dispatch:
  1. try `resolveRedraftMatchupContext` (redraft-family),
  2. else `resolveGenericMatchupContext` (existing `TeamWeekResult`/`Roster` behavior,
     incl. its 404s), then
  3. a **single shared assembler** (`assembleFromContext` → `assembleSidesPayload`)
     scores both sides via the Phase 2b canonical adapter, attaches media, and builds
     the payload — used by *both* sources, so no assembly or scoring math is
     duplicated. `bye` renders the selected lineup vs "No opponent"; `none` returns a
     clear, non-crashing empty payload with an explainable reason.

### Guarantees met
- Matchup-center renders the correct **redraft teams** (`RedraftRoster` identity) and
  **player rows** (`RedraftRosterPlayer`).
- DEF rows display readable names ("KC Defense"); **no raw `nfl:def:` leakage**.
- Matchup total = the **engine-persisted** `RedraftMatchup` score (`engineTotalPoints`).
- Generic/non-redraft leagues keep their existing source unchanged.
- No invented pairings; missing matchup → explainable `none`; missing opponent → `bye`.

### Tests
`__tests__/matchup-center/redraft-matchup-source.test.ts` — **9 deterministic tests**:
starter filtering (bench excluded), DEF readable + no leak, engine total/record/team
carry-through, home/away selection + score swap, bye (no invented opponent), and the
end-to-end regression (both teams + player rows + DEF readable + totals = engine).
Typecheck clean on all new/changed files (one pre-existing `league.teams.map`
implicit-any remains, not introduced here).

### Pending for full proof (does not move readiness yet)
Staging E2E (seed `RedraftMatchup`/`RedraftRoster`/`RedraftRosterPlayer`/
`PlayerWeeklyScore` → matchup-center returns both teams + rows + DEF + engine total)
and the browser proof remain, as does the 30-second server polling loop. Per the
readiness rule NFL stays 92 until those pass.

## Phase 2d — Staging + browser proof of the unification (staging GREEN)

### Correctness fix found during the audit
The seed isolates `PlayerWeeklyScore` under `RedraftSeason.season` (a sentinel year),
but `assembleSidesPayload` looked up scores at `base.season` (= `League.season`), so
per-player scores would be 0. Fixed by carrying the scoring season/week through the
source: `MatchupSideContext` gained `scoreSeason`/`scoreWeek`; the redraft source sets
them to `RedraftSeason.season` + resolved week; `assembleSidesPayload` uses
`scoreSeason ?? base.season`. Generic sources omit them → unchanged behavior. (A real
redraft league usually has `RedraftSeason.season === League.season`, so this is a
no-op there, but it is the correct design.)

### Staging proof — GREEN
Added **MC1** to the staging engine E2E (`scripts/run-nfl-full-season-engine-e2e.ts`),
run against the Neon **staging** branch (validated non-production via
`npm run check:staging-env`; `DATABASE_URL` overridden from `.env.staging`). It seeds
the full redraft matchup (canonical league → completed draft → RedraftSeason/Roster/
RosterPlayer incl. `nfl:def:KC` → PlayerWeeklyScore → RedraftMatchup w/ persisted
scores via the reused `seedG8CommissionerLeague`), calls `buildMatchupCenterPayload`,
and asserts:
- both redraft teams appear (`[<commish> Team, Open Team 2]`),
- home + away rosters render **player rows** (home 8, away QB after the seed now slots
  both rosters),
- **KC Defense** renders, **no raw `nfl:def:` name leak**,
- DEF score = **21** (canonical `def_sack 3×5 + def_int 1×2 + PA(10) tier 4`),
- matchup-center total = **44** = the engine-persisted `RedraftMatchup` score.

Result: **NFL ENGINE E2E SUMMARY — PASS 29 · FAIL 0** (the prior 28 + MC1). Seed
cleanup verified (`SEED2`: league gone, weekly scores 0). Seed helper extended to slot
both rosters + add an away-QB score so both sides carry real canonical scores; cleanup
tracks the away score id.

### Browser proof — spec ready, execution environment-blocked
`e2e/g8-team-defense-browser.spec.ts` step 4 was upgraded to assert the **matchup-center
UI** itself: the matchups tab renders `<TEAM> Defense`, no raw id leak, and the
matchup-center API returns home+away player rows with the total matching the engine.
The spec is opt-in (`RUN_G8_DST_BROWSER=1`) and self-seeds against the E2E route
(guarded `NODE_ENV!=='production' && x-allfantasy-e2e:1`).

Execution was **blocked by the local environment**: a fresh Node-20 `next dev` (pointed
at staging — verified that `@next/env` does not override the shell `DATABASE_URL`, so
`.env.local`'s production URL is ignored) **binds the port but never finishes compiling**
(`csrf` hangs >60s, log stuck at "Starting…") — the same recurring local dev-server
hang documented in prior phases. This is an environment issue, not a code defect: the
staging proof exercises the identical `buildMatchupCenterPayload` path end-to-end
against the real staging DB. The browser run remains the only outstanding item for this
surface and can be executed once a stable Node-20 app is available.

### Readiness
**NFL stays 92 / Overall 88.** The score-store + matchup-source unification is now
**staging-proven** through the real service. Per the rule, 93 still requires the
**30-second server polling loop** (next: Phase 3) plus the browser live proof.

## Phase 3 — Live polling orchestrator (engine BUILT + staging-proven)

### Audit of refresh paths
| Path | Today | Verdict |
|---|---|---|
| cron | `/api/redraft/score-sync` (`*/5 * * * *`) → `runRedraftSeasonScoring` = full re-sync + recalc ALL matchups + ALL standings | rescore-everything, 5-min, not incremental |
| score sync | `syncPlayerWeeklyScoresForRedraftSeason` (PlayerWeeklyScore upsert) | full per season |
| matchup refresh | `recalculateMatchupsForSeasonWeek` → `updateMatchupScores` | per-matchup, but all |
| SSE | `leagueRealtimeStore.publish` → `/api/leagues/[id]/events/stream` → `useLeagueEventStream` (the `/api/redraft/stream/[seasonId]` route is a JSON stub) | works; in-process pub/sub, swappable to Redis |
| browser polling | `MatchupTabContainer` polls `refreshIntervalMs` (30s live) | **per-browser poll** — to be replaced by SSE subscription (Phase 4) |
| cache invalidation | `dedupeLeagueRequest` + Next revalidate | fine |
| stat corrections | `statCorrectionService` → `processLeagueWeek` (generic); redraft re-sync is idempotent upsert | handled by idempotent re-sync |

Duplicated: two scoring orchestrators (generic `weeklyProcessor` vs `redraftSeasonScoringRunner`). Rescore-everything: both. Incremental: **none** (the gap Phase 3 fills). Concept-specific: score-sync also bridges c2c/survivor/zombie.

### The reusable orchestrator (single scheduler — no second polling impl)
`lib/live-scoring/orchestrator.ts` — `runLiveScoringTick(games, deps, now)` composes the Phase 2 engine into one deterministic, dependency-injected flow used by **every concept**:

`resolvePollCadence` (PRE_GAME 2m / LIVE·HALFTIME·OVERTIME 30s / FINAL stop / SUSPENDED 5m heartbeat; only `gameIdsToPoll` are fetched — never finalized games or empty weeks) → `fetchActiveStats` → `diffChangedPlayers` (idempotent; **key-order-insensitive** so JSONB key reordering never false-diffs) → `planIncrementalRescore` (only affected rosters/matchups; standings only when a **final** matchup moved) → `persistChangedStats` (changed only) → `applyRescore` (affected only) → `buildLiveBroadcastEvents` → `broadcast` (only affected: `player_changed`, `projection_changed`, `matchup_changed`, `standings_changed`, `league_changed`).

All I/O is injected, so a concept supplies its own provider/store/scorer/broadcaster; the orchestrator stays pure and testable. Stat corrections are just a diff that flows through the same path (idempotent replay).

### Tests
- `__tests__/live-scoring/orchestrator.test.ts` — **14 deterministic tests**: cadence gating (final/postponed → no fetch/stop; live/OT → 30s), idempotent no-op poll (no persist/rescore/broadcast), off-roster change (persist but no rescore), live TD / FG / DEF (sack + return TD) incremental, stat-correction replay, standings-only-on-final, and `buildLiveBroadcastEvents` affected-only purity.
- `diffChangedPlayers` key-order test added (Postgres JSONB safety).
- Total live-scoring suite **46 pass**; typecheck clean.

### Staging proof — GREEN
Added **LIVE1** to the staging engine E2E (run against the Neon staging branch): drives `runLiveScoringTick` with **real DB-backed deps** (PlayerWeeklyScore read/upsert, RedraftRoster/RedraftMatchup topology, `recalculateMatchupsForSeasonWeek`) + a fixture provider where a live sack bumps the DEF 3→5. Asserts only the DEF is detected (`changed=[nfl:def:KC]`, QB unchanged), the affected matchup is rescored, the **engine total rises 44→54** (+2 sacks × 5), and only affected entities broadcast. **Result: NFL ENGINE E2E — PASS 30 · FAIL 0** (28 base + MC1 + LIVE1).

### Remaining Phase 3 wiring (not shipped)
The orchestrator core is proven; the production loop still needs: a **live provider binding** for `fetchActiveStats` (map active NFL games → player stat lines from the provider — needs the live game-state feed from Phase 2c, quarter/clock) and a **scheduled server runner** (external worker, not Vercel's 5-min cron) that ticks per `nextPollDelayMs`. These are the integration layer on top of the proven engine.

## Phase 3b — Live provider binding + scheduled runner (BUILT + staging-proven)

### Provider audit (best available NFL source)
| Capability | Source | Status |
|---|---|---|
| active games + status | `SportsGame` schedule table | ✅ (status COARSE: scheduled/in_progress/final; suspended/postponed only if the import supplies them) |
| player stat lines | Sleeper week-wide stats → `normalizeNflWeeklyStats` | ✅ (offensive `playerId → Sleeper id` mapping must be validated on a live league) |
| team DEF/ST stat lines | Sleeper via `fetchSleeperTeamDefenseSeason` + `extractSleeperWeekStats` → `normalizeNflTeamDefenseWeeklyStats` (G8/G9) | ✅ |
| final status | `SportsGame.status='final'` | ✅ |
| stat corrections | re-fetch + diff (provider wins); full 5-min sync remains reconciliation fallback | ✅ |
| **quarter / period** | none | ❌ **GAP** — no column/feed; game-clock UI stays blocked |
| **game clock** | none | ❌ **GAP** — same |

Rolling Insights = season aggregates only; TheSportsDB/ESPN could supply clock later
but are not the stat source. Rate limits handled by the existing `rateLimitManager`.

### Reusable boundary + NFL implementation
- `lib/live-scoring/provider.ts` — `LiveStatsProvider` interface (`fetchActiveGames`,
  `fetchPlayerStatsForGames` scoped to rostered ids, `fetchTeamDefenseStatsForGames`,
  `normalizeGameStatus`) + pure helpers (`gamesToSnapshots` — clock `null`,
  `teamsInGames`) + `FixtureLiveStatsProvider` for tests/staging.
- `lib/live-scoring/nflLiveStatsProvider.ts` — NFL impl over `SportsGame` + the proven
  Sleeper DEF path + Sleeper week-wide offensive stats. **No fabrication**: any fetch
  failure / missing row yields no entry. DEF/ST flows through the G8/G9 normalizers; the
  real-game points-allowed derivation in the engine is untouched.

### Scheduled runner + cron
- `server/services/liveScoring/liveScoreRunner.ts` — `runLiveScoringForActiveSeasons`
  (+ `runLiveScoringTickForSeason`): for each active redraft season, builds
  `LiveTickDeps` from the provider + Prisma + the canonical engine
  (`recalculateMatchupsForSeasonWeek`, `updateStandings` only when standings move) and
  runs one `runLiveScoringTick`. Provider **and** broadcast are injected (cron uses the
  real NFL provider + `leagueRealtimeStore`; staging/tests inject a fixture + collector).
  Per-season failures isolated.
- `app/api/cron/live-score-tick/route.ts` — cron-auth (`requireCronAuth`) + `withSyncJobRun`
  telemetry, idempotent, production-safe. Registered in `cronRegistry` (`cron-live-score-tick`,
  category `scores`, staleAfterH 1, instrumented) and `vercel.json` (`* * * * *`).
- The existing 5-minute full `score-sync` is **kept** as the reconciliation/correction
  fallback.

### Cadence note
Vercel cron's finest granularity is 1 minute, so the cron runs `* * * * *`; the engine's
true 30-second LIVE cadence (`nextPollDelayMs`) requires an external worker ticking on
the returned delay — the cron is the production-native floor until that worker exists.

### Tests + staging proof
- `__tests__/live-scoring/provider.test.ts` — **6** (snapshot clock-gap, team extraction,
  fixture id-scoping, status normalization). Live-scoring suite **52 pass**; typecheck clean.
- Staging E2E **LIVE2** (run against the Neon staging branch): the scheduled runner with a
  `FixtureLiveStatsProvider` + injected broadcast collector drives a DEF sack bump → only
  the DEF persists/rescenes, **matchup total rises 54→59**, affected SSE events collected;
  a rerun with the same fixture is a **no-op** (0 changed, no new broadcast, total stable).
  **NFL ENGINE E2E: PASS 31 · FAIL 0** (base 28 + MC1 + LIVE1 + LIVE2).

### Remaining (not shipped)
A production worker ticking at the true 30s cadence; validation of the offensive
`playerId → Sleeper id` mapping against a live league; and the quarter/clock feed (gap).

## Phase 3c — External 30-second worker (BUILT + staging-proven)

### Hosting audit
Vercel cron floor = 1 minute (the `live-score-tick` fallback). True 30s polling needs a
long-running process. Options: Railway worker / container (preferred — the repo already
deploys on Railway), a standalone `tsx` script, or a scheduled GitHub Action (min 5m, too
coarse). Chosen: a `tsx` daemon (`scripts/live-score-worker.ts`) deployable on Railway,
reusing the exact Phase 3b runner.

### Worker (reuses the runner — no second scoring impl)
- `lib/live-scoring/workerLoop.ts` — PURE controller: `resolveWorkerSleepMs` (clamp the
  engine cadence to `[min,max]`; cadence 0 → idle re-check, so the daemon keeps watching
  for new games rather than stopping), `createOverlapGuard` (single-flight — a slow tick
  never overlaps the next), `runWorkerLoop` (sequential tick→sleep until `shouldStop`,
  graceful: no sleep after a stop is requested mid-loop).
- `server/services/liveScoring/liveScoreRunner.ts` — now returns an aggregate
  `nextPollDelayMs` (tightest positive cadence across active seasons) for the worker to
  sleep on.
- `scripts/live-score-worker.ts` — the daemon: **starts only when
  `LIVE_SCORE_WORKER_ENABLED=true`** (never by accident), logs the **masked** DB host
  every start (never silent about which DB), graceful SIGINT/SIGTERM shutdown, overlap
  guard, ticks `runLiveScoringForActiveSeasons`. Cadence bounds overridable via
  `LIVE_SCORE_WORKER_MIN_MS` / `_MAX_MS` / `_IDLE_MS`.
- `npm run worker:live-score` (alias).

### How to run
- **Staging:** `LIVE_SCORE_WORKER_ENABLED=true DATABASE_URL=<staging> npm run worker:live-score`
  (validate first with `npm run check:staging-env`).
- **Production:** deploy on a long-running Railway service with
  `LIVE_SCORE_WORKER_ENABLED=true` + the prod `DATABASE_URL`. Keep the Vercel
  `live-score-tick` cron (1-min fallback/reconciliation) and the 5-min full score-sync.

### Cadence layering (defense in depth)
1. **External worker** — true 30s during live games (primary).
2. **Vercel cron `live-score-tick`** — every minute (fallback if the worker is down).
3. **5-min full score-sync** — reconciliation + official stat corrections.

### Safety
Explicit enable flag · masked DB-host logging · overlap guard · graceful shutdown · no
production default · staging tests use the staging DB only · the daemon is never started
by tests (tests drive the pure loop with fakes / the runner with a fixture provider).

### Tests + staging proof
- `__tests__/live-scoring/worker-loop.test.ts` — **14**: sleep selection (clamp/idle/
  floor/cap/defaults), overlap prevention (skip-while-running, clears on throw),
  multi-tick loop, graceful stop (no sleep after stop / immediate stop), idle on cadence 0.
  Live-scoring suite **64 pass**; typecheck clean.
- Staging E2E **LIVE3**: `runWorkerLoop` drives the real `runLiveScoringTickForSeason`
  (fixture provider, fake sleep) → ticks at the **30s live cadence**, sleeps once between
  ticks, stops gracefully. **NFL ENGINE E2E: PASS 32 · FAIL 0** (base 28 + MC1 + LIVE1 +
  LIVE2 + LIVE3).

**Phase 3 is now production-architecture complete** (orchestrator + provider + runner +
cron fallback + external 30s worker, all staging-proven). Remaining before 93: Phase 4
UI + browser proof (and validating the offensive `playerId → Sleeper id` mapping live).

## Browser environment stabilization (RESOLVED) — stable runtime for Phase 4 + proofs

### Audit
- Node 20 (`v20.19.0`), Next 14.2.35, Prisma client generated — all fine.
- **`next dev` is genuinely hung**, not slow: it binds the port but stays at "Starting…"
  (never "Ready") for 150s+, reproducibly, even after clearing `.next-dev-local`, with
  `--max-old-space-size=4096` and the direct Node-20 binary. Root cause is the dev
  on-demand compile/init on this large app on Windows — not a stale cache, Node version,
  or env issue. (`next.config.js` wraps Sentry/bundle-analyzer; disabling Sentry for the
  build avoids unrelated overhead.)
- **Staging DB is safe**: `@next/env` only fills keys *absent* from `process.env`, so a
  shell-set `DATABASE_URL` wins over `.env.local`'s production value; validated
  non-production via `npm run check:staging-env`.

### Decision: production build + `next start` (the reliable runtime)
`next dev` is unstable → use a prod build + `next start`. Result: **`next start` is
"Ready in ~1.5s" and `/api/auth/csrf` returns 200 in ~3–4s** (vs dev's infinite hang).

### Config-defect fix (test gates, not product behavior)
`next start` runs in production mode, but the E2E **seed** and **register** bypasses were
gated `NODE_ENV !== 'production'` → they'd 404/disable under `next start`. Both now also
allow an explicit `ALLOW_E2E_SEED=1` opt-in (still header-gated by `x-allfantasy-e2e`).
**The real production deploy never sets `ALLOW_E2E_SEED`**, so both stay disabled there.
These are the only two E2E-gated routes (verified).

### Stable browser commands (Node 20 + staging DB)
```bash
# 1) validate staging env (refuses if it looks like production)
npm run check:staging-env
# 2) build once (Node 20; Sentry off for speed). DATABASE_URL = staging.
DATABASE_URL=<staging> SENTRY_DSN= NEXT_PUBLIC_SENTRY_DSN= npm run build:staging
# 3) serve (Node 20, prod mode, staging DB, E2E affordances on) on :3017
DATABASE_URL=<staging> ALLOW_E2E_SEED=1 npm run start:staging
# 4) run the browser proof against it
RUN_G8_DST_BROWSER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3017 npm run test:e2e:staging
```
(Node 20 must be the active `node` — e.g. via nvm. `next dev` remains unusable here; a
prod build is required after each code change until the dev hang is separately solved.)

### Proof — browser flow GREEN on the stable runtime
The full G8/R1/G11-Phase-2 spec (`e2e/g8-team-defense-browser.spec.ts`) **passed (59.5s)**:
register/login → self-seed → ROSTER shows "KC Defense" (no `nfl:def:` leak) + DEF slot →
commissioner DEF override reached the engine → **matchups tab renders the redraft pairing,
KC Defense, player rows, and a total matching the engine** (Phase 2c/2d confirmed *in the
browser*, not just staging). NFL stays **92** until Phase 4 UI lands.

## Phase 4A — Live matchup experience (audited + browser-proven)

### Audit (honest): the matchup live UI was largely already built
Prior "Matchup Command Center" work already shipped most of 4A. Verified present:
- `MatchupTabContainer` **subscribes to SSE** (`useLeagueRealtimeRefresh` → silent
  refetch) with a poll **fallback**, and shows a last-updated ("Xm ago") stamp.
- `MatchupHeaderCard`: live team score, projected total, "N left to play" (remaining),
  win-probability bar, Live/Final/Upcoming status badge.
- `MatchupStarterRow`: headshot, team vs opponent, live pulse dot, injury, current
  points, projected points, and a **score-change flash animation** (delta via
  `prevPointsRef` → fade-out "+x").
- Quarter/clock are correctly **not fabricated** (provider gap) — rows show a Live dot,
  not invented data.

The one remaining 4A polish gap: an **expandable per-row stat breakdown**
(passing/rushing/receiving/DEF) — not yet built.

### What this turn added: the live-update browser proof
The live loop existed but had **never been browser-verified end-to-end**. Added:
- `app/api/e2e/live-tick/route.ts` — gated (`ALLOW_E2E_SEED=1` + `x-allfantasy-e2e`)
  endpoint that runs the Phase 3 runner with a fixture provider (bumps the rostered
  DEF +1 sack) and broadcasts the affected SSE events via the real `leagueRealtimeStore`.
- `data-testid` on the matchup header totals.
- A browser-spec step that, on the open matchups tab, reads the home total, POSTs a
  live tick, and asserts the **header total rises via SSE without a page reload**.

### Browser proof — GREEN (stable prod runtime, staging DB)
`e2e/g8-team-defense-browser.spec.ts` **passed (1.1m)** end-to-end:
self-seed → ROSTER "KC Defense" (no `nfl:def:` leak) + DEF slot → engine override →
**matchups tab renders both redraft teams + KC Defense + player rows, total = engine**
→ **live tick changes a DEF stat → SSE reaches the browser → matchup total updates
without reload**. Cleanup verified **zero staging residue** (0 leagues, 0 sentinel
scores). (Step-4 timeout was raised to 120s to absorb remote-staging-DB latency — the
matchup-center makes several sequential round-trips; behavior was already correct.)

### Known issue found (flagged separately, not fixed here)
`finalizeDraftToRedraftSeason.ts` schedule-gen orders `RedraftRoster` by a non-existent
`createdAt` field → invalid query throws (caught/non-fatal during seed because the seed
creates its matchup manually). Real leagues relying on that path may not get an
auto-generated schedule. Fixing it inline would double-create the seed's schedule, so it
was flagged as a separate task rather than rushed.

### Readiness
**NFL stays 92.** Phase 4 is **not** complete — only 4A is built + browser-proven.

## Phase 4 — remaining (NOT shipped)
- **4B Team page live** — `TeamTab` has no SSE subscription (static "live feed coming
  soon"); make the roster live (player points/proj/status auto-update).
- **4C League home live scoreboard** — all matchups, top scorer, closest matchup, upset.
- **4D Dashboard live widgets** — live games, my live points, projected finish, alerts.
- **4E Live event feed + expandable stat breakdown** — reusable event component.
- Full browser proof across Team/League/Dashboard.

These reuse the same SSE (`useLeagueRealtimeRefresh`) + the matchup live primitives — no
new polling. NFL → 93 / Overall → 90 only after all of Phase 4 is complete + browser-proven.

Phase 4 (animated live scoreboard, live player rows with NFL game state + stat lines,
scoring timeline, live team/league/dashboard) consumes Phase 3 over the existing SSE
(`useLeagueEventStream`) — components subscribe, never poll. It is a large front-end
build that requires the Phase 3 server loop emitting real events **and** a working
browser environment to verify the animations/subscriptions. Deferred until the
server loop is wired and a stable Node-20 app is available for the browser proof.

## Phase 4B–4E — live surfaces (BUILT, all reuse the same SSE)

All four surfaces subscribe to the existing league SSE (`useLeagueRealtimeRefresh`)
and silently re-fetch on score/matchup/player events — **no new polling loop**, no
redraft-only hack. Each is concept-agnostic at the data layer.

- **4B Team page live** — `TeamTab` subscribes to the league stream and re-fetches
  `/api/redraft/roster` on `player_changed`, so per-player PTS update without a reload.
- **4C League home live scoreboard** — `LeagueScoringPreviews` (the `league` tab)
  renders all matchups + highlight chips (top scorer / closest matchup / upset alert)
  and re-fetches `/scoring/matchups` on score events.
- **4D Dashboard live widget** — `DashboardLiveScoresWidget` fetches
  `/api/dashboard/live-scores` (every active redraft season the user owns) and
  re-fetches on SSE for the primary league; per-league live score cards.
- **4E Live event feed + expandable breakdown** — `LeagueActivityFeed` renders the
  **real** `/activity-feed` data (`LeagueEvent` + `activityEvent`, not a stub) and
  re-fetches on SSE; each `LeagueScoringPreviews` matchup row expands into a per-player
  breakdown from `/scoring/roster-scores` (computed via `calculateScoreFromSportConfig`).

### Architecture cleanup (done with 4B–4E)
- Canonical DTOs live in `lib/types/liveScoring.ts` (`DashboardLiveScore`,
  `RosterScorePlayer`); **route files no longer export shared types** — they import them.
- Matchup highlight calculation moved out of the UI into the pure, tested
  `lib/live-scoring/matchupHighlights.ts` (`deriveMatchupHighlights`), covered by
  `__tests__/live-scoring/matchup-highlights.test.ts` (7 deterministic tests).
- **Deferred (documented, not attempted now):** SSE subscription de-duplication.
  Today each live surface opens its own `EventSource`; the future cleanup is a single
  `LeagueRealtimeProvider` (one `EventSource` → React context → all surfaces). It is a
  debugging/efficiency improvement, not a correctness gap, so it is intentionally left
  for a later pass.

## Phase 4F — Full live-experience browser proof (GREEN)

The complete live experience was browser-proven end-to-end on the stable runtime
(Node 20 + `next start`, staging DB, `ALLOW_E2E_SEED=1`). Staging safety validated first
(`npm run check:staging-env` PASS; shell `DATABASE_URL` confirmed to win over
`.env.local`'s production value via `@next/env`; staging host ≠ production host).

`e2e/g8-team-defense-browser.spec.ts` **passed (1.2m)**, proving every surface against
real engine data with live SSE updates and no page reloads:
- **Roster/Team (A):** `KC Defense` renders, no `nfl:def:` leak, DEF slot present, DEF
  PTS rises via SSE after a live tick (4B).
- **League home (C):** scoreboard (`league-scoring-previews`) renders, survives the
  SSE-driven refresh (4C).
- **Dashboard (D):** `dashboard-live-scores` widget + the seeded league's live score
  card (`live-score-row-<id>`) render and survive the SSE refresh (4D).
- **Event feed / breakdown (E):** real-data `league-live-event-feed` renders, the
  expandable `matchup-list` renders and a matchup row expands its per-player breakdown,
  all surviving the SSE refresh (4E).
- **Matchup center (B):** both redraft teams + player rows + `KC Defense`, matchup-center
  total = engine-persisted `RedraftMatchup` total; a live tick raises the header total
  via SSE without reload (Phase 2c/2d/4A regression still green).
- **Engine truth (R1):** the commissioner DEF override is reflected in the roster API.

### Selector fixes found during the proof (test-only; no product change)
- The league scoreboard lives on the `league` tab, whose **label varies by role** (a
  commissioner sees "Commissioner Hub"). The spec now clicks the stable
  `data-testid="league-tab-league"` instead of an accessible-name regex.
- The dashboard has **no `<nav>` landmark**; the spec now anchors on the live-scores
  widget itself (the actual subject) rather than `getByRole('navigation')`.
These were the only blockers; once corrected the proof passed first time.

### Cleanup
Zero staging residue after the run (0 seeded leagues, 0 sentinel-season scores). Four
orphaned QB score rows from the two **earlier failed runs** (which had hit the spec's
8-minute timeout before the selector fixes, cutting their `afterAll` cleanup short) were
removed; with the selectors fixed, failing steps fail fast so `afterAll` always completes.

### Readiness
**NFL 92 → 93 / Overall 88 → 90.** Per the rule, this required engine tests + staging
E2E + the browser proof to all pass — they now do, across all live surfaces. The
remaining items below 100% (live quarter/clock game-state feed, production 30s worker
deployment, validating the offensive `playerId → Sleeper id` map on a live league)
are tracked in the phases above and do not block this increment.

## Phase 4G — Schedule-generation `createdAt` bug (Tier 1 fix, 2026-06-27)

**Bug:** `ensureScheduleForNewSeason` in `finalizeDraftToRedraftSeason.ts` called
`prisma.redraftRoster.findMany({ orderBy: { createdAt: 'asc' } })`. `RedraftRoster` has
no `createdAt` column — Prisma throws a runtime error for any real league that triggers
auto-schedule generation after draft finalization. The bug was non-fatal in the E2E seed
(the `.catch()` wrapper swallowed it) but silently skipped schedule creation.

**Fix:** Changed to `orderBy: { id: 'asc' }`. `RedraftRoster.id` is a cuid, monotonically
issued, so it gives a deterministic, schema-valid ordering that round-robin schedule
generation can reproduce across runs. A brief comment explains the choice.

**Tests added** (`__tests__/redraft/draft-finalize-schedule.test.ts`, 4 new):
- Regression pin: `findMany` is called with `{ id: 'asc' }`, never `{ createdAt: ... }`
- Schedule rows created when no schedule exists yet (matchup count = 0)
- Idempotent: existing schedule (count > 0) skips both `findMany` and `createMany`
- Skipped when fewer than 2 rosters are present

Full redraft suite: **378 pass, 0 fail** (was 374 before; 4 new).

**Readiness:** No change from 93 / 90 — this removes a Tier 1 production blocker but the
readiness-credit rule requires a browser/staging proof per the commissioner-first-bar.
A full schedule-generation audit (create, edit, commissioner overrides) belongs to G13.

---

## Phases 5–7 — plan (NOT yet shipped)

These are the remaining, larger build — sequenced so each lands with tests + proof
before readiness moves.

- **Phase 2b — Server live loop + cache.** A scheduled worker (external cron/queue,
  not Vercel 5-min) drives `resolvePollCadence`; on each tick poll only
  `gameIdsToPoll`, ingest stats, `diffChangedPlayers` → `planIncrementalRescore` →
  rescore only affected players/matchups (+ standings on final), upsert to a single
  canonical live store, broadcast `score_update` over the existing SSE stream.
  **Unify `WeeklyScore`/`PlayerWeeklyScore`** so the live UI and engine read one store.
- **Phase 2c — Live game state.** Extend `SportsGame` (or a `LiveGameState` table)
  with quarter/clock/period/possession + a provider that fills it, feeding
  `fractionElapsed` into projections and the Phase-3 player rows.
- **Phase 3 — Matchup page.** Live team score with animated transitions, projected
  winner %, win probability (engine), players/games remaining, projected final, last-
  updated; per-player rows (FP / projection / Δ / game status Q1–OT/Final / opponent /
  live NFL score / live stat line) and an expandable live scoring-event feed.
- **Phase 4 — Team page.** Live roster (FP, live projection, NFL score, clock,
  opponent, injury, live stats, ownership, start %, trend, weather) + live player modal.
- **Phase 5 — League page.** Live standings/power rankings/division/weekly leaders/
  closest matchup/highest score/upset alert.
- **Phase 6 — Performance.** Wire `planIncrementalRescore` + `diffChangedPlayers` into
  the live loop; batch writes; debounce browser updates.
- **Phase 7 — Testing.** Extend engine tests (TD/FG/correction/OT/double-header/
  postponement/DEF/return TD+yards/standings/matchup/projection) + staging E2E +
  browser proof (live updates without refresh, animated totals, no duplicate scoring).

---

## Readiness

- **NFL 93 / Overall 90** (raised after Phase 4F). The full live pipeline — engine core,
  score-store + matchup-source unification, orchestrator + provider + runner + cron
  fallback + 30s worker, and all four live UI surfaces (Team / League / Dashboard /
  Event feed) — is shipped with engine tests + staging E2E + a green browser proof.
- The engine core is the reusable foundation all concepts inherit (architecture rule
  satisfied at the core layer); the live pipeline and UI are built on top of it.
- Remaining toward 100% (do **not** credit until proven): live quarter/clock game-state
  feed, production deployment of the external 30s worker, validating the offensive
  `playerId → Sleeper id` map against a live league, and the SSE `LeagueRealtimeProvider`
  de-duplication.
