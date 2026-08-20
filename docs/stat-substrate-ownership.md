# Stat substrate ownership & reconciliation strategy (Phase 7C)

**Scope:** Architecture clarification only — **do not** merge `PlayerGameStat` / `PlayerWeeklyScore`, **do not** rewrite scoring, **do not** migrate consumers, **do not** redesign matchup/standings UI.

**Companion:** Active week resolution — `docs/scoring-week-resolution.md`.

**Pointer comments in code:** `lib/multi-sport/MultiSportMatchupScoringService.ts`, `lib/schedule-stats/StatIngestionService.ts` (Phase 7C cross-links).

---

## 1. Search methodology (Windows-safe)

| Method | How it was used |
|--------|------------------|
| **`git grep`** (primary) | From repo root: `git grep -l "<pattern>" -- "*.ts" "*.tsx"` (and `*.cjs` / `*.md` where noted). Works in Git Bash / PowerShell when `git` is on `PATH`. |
| **Workspace `grep` tool** | Scoped `lib/`, `app/`, `server/`, `prisma/` for Prisma delegate calls (e.g. `prisma.playerWeeklyScore`) to avoid full-repo timeouts. |
| **Fallbacks (not required this pass)** | PowerShell: `Get-ChildItem -Recurse -Include *.ts,*.tsx \| Select-String -Pattern '…'` (slower). Optional: `npx --yes @vscode/ripgrep` if `git` unavailable. |

**Caveats**

- **CamelCase vs PascalCase:** Prisma client uses **camelCase** delegates (`playerGameStat`, `playerWeeklyScore`, `teamPerformance`, `redraftMatchup`) in application code; **`git grep`** was run for both forms where useful.
- **Route churn:** Some cron/API paths (e.g. `app/api/cron/import-scores`, `app/api/internal/schedule-stats/ingest`) may be **missing or temporarily excluded** from a given tree or production bundle (`scripts/vercel-next-build.cjs`). File lists below reflect **`git grep` on the workspace snapshot** at audit time.
- **`.claude/worktrees/*`:** Duplicate paths under worktrees were **ignored** for product ownership; only main-line paths are listed.

---

## 2. Files found by substrate / keyword (audit snapshot)

### 2.1 `playerGameStat` (delegate) — references

`lib/data-warehouse/HistoricalFactGenerator.ts`  
`lib/multi-sport/MultiSportMatchupScoringService.ts`  
`lib/player-trend/TrendDetectionService.ts`  
`lib/schedule-stats/StatIngestionService.ts`  
`lib/scoring/best-ball-engine.ts`

### 2.2 `PlayerGameStat` (string / type / comments)

`app/api/redraft/score-sync/route.ts`  
`lib/category-scoring/NbaCategoryRegistry.ts`  
`lib/data-warehouse/HistoricalFactGenerator.ts`  
`lib/data-warehouse/pipelines/index.ts`  
`lib/idp/IDPScoringPresets.ts`  
`lib/league-creation-preset/scoring-presets.ts`  
`lib/multi-sport/MultiSportMatchupScoringService.ts`  
`lib/schedule-stats/StatIngestionService.ts`

### 2.3 `playerWeeklyScore` (delegate)

`lib/bestball/optimizer.ts`  
`lib/c2c/scoringEngine.ts`  
`lib/devy/scoringEligibilityEngine.ts`  
`lib/guillotine/eliminationEngine.ts`  
`lib/redraft/scoringEngine.ts`  
`lib/survivor/gameStateMachine.ts`  
`lib/survivor/survivorScoringPipeline.ts`  
`server/services/weeklyProcessor.ts`

### 2.4 `PlayerWeeklyScore` (model name in comments / UI / seed)

`app/api/redraft/score-sync/route.ts`  
`app/c2c/components/C2CPlayerModal.tsx`  
`lib/c2c/ai/c2cChimmy.ts`  
`lib/multi-sport/MultiSportMatchupScoringService.ts`  
`lib/schedule-stats/StatIngestionService.ts`  
`lib/survivor/survivorScoringPipeline.ts`  
`prisma/seed/survivorPowers.ts`  
`server/services/scoringEngine.ts`  
`prisma/schema.prisma` (model definition)

### 2.5 `teamPerformance` (delegate)

`app/api/leagues/[leagueId]/matchups/route.ts`  
`lib/ai-payload/resolveAiTeamContext.ts`  
`lib/ai-tools-start-sit/opponentMatchup.ts`  
`lib/big-brother/BigBrotherChatChannels.ts`  
`lib/data-warehouse/HistoricalFactGenerator.ts`  
`lib/league-import/sleeper/SleeperLeagueCreationBootstrapService.ts`  
`lib/league/format-artifact-service.ts`  
`lib/league/sleeper-import-process.ts`  
`lib/matchup-prep-dashboard/resolveMatchupOpponent.ts`  
`lib/power-rankings-dashboard/afLeaguePowerTruth.ts`  
`lib/scoring/scoring-engine.ts`  
`lib/survivor/SurvivorTimelineResolver.ts`  
`lib/survivor/SurvivorVoteEngine.ts`  
`lib/survivor/immunityEngine.ts`  
`lib/zombie/ZombieResultFinalizationService.ts`  
`lib/zombie/rosterTeamMap.ts`  
`prisma/seed.ts`

### 2.6 `TeamPerformance` (PascalCase — fewer matches)

`app/api/redraft/score-sync/route.ts`  
`lib/data-warehouse/HistoricalFactGenerator.ts`  
`lib/data-warehouse/pipelines/index.ts`  
`lib/league-import/sleeper/SleeperLeagueCreationBootstrapService.ts`  
`lib/multi-sport/MultiSportMatchupScoringService.ts`  
`lib/specialty-league/common-automation.ts`  
`lib/survivor/SurvivorVoteEngine.ts`  
`lib/zombie/ZombieResultFinalizationService.ts`  
`lib/zombie/ZombieUniverseStandingsService.ts`  
`lib/zombie/rosterTeamMap.ts`

### 2.7 `redraftMatchup` (delegate)

`__tests__/redraft-multi-sport-route-parity.test.ts`  
`app/api/c2c/automation/route.ts`  
`app/api/redraft/matchup/route.ts`  
`app/api/redraft/score-sync/route.ts`  
`app/api/redraft/season/route.ts`  
`lib/c2c/scoringEngine.ts`  
`lib/chimmy-enhancements/ChimmyEnhancedContextProvider.ts`  
`lib/integrity/TankingDetectionEngine.ts`  
`lib/redraft/ai/matchupAnalyzer.ts`  
`lib/redraft/scoringEngine.ts`  
`lib/redraft/standingsEngine.ts`  
`lib/tournament/computeTournamentWeeklyPoints.ts`  
`lib/zombie/bashingEngine.ts`  
`lib/zombie/matchupCompletion.ts`  
`lib/zombie/maulingEngine.ts`  
`lib/zombie/serumEngine.ts`  
`lib/zombie/weaponEngine.ts`  
`lib/zombie/weeklyResolutionEngine.ts`  
`lib/zombie/weeklyUpdateEngine.ts`

### 2.8 Orchestration keywords

| Keyword | Files (main line) |
|---------|-------------------|
| **`scoreLeagueWeek`** | `lib/scoring/scoring-engine.ts`, `lib/workers/scoring-worker.ts` |
| **`processLeagueWeek`** | `app/api/leagues/[leagueId]/scoring/process-week/route.ts`, `lib/scoring-defaults/queueLeagueScoringRecalc.ts`, `server/services/statCorrectionService.ts`, `server/services/weeklyProcessor.ts` |
| **`updateMatchupScores`** | `lib/redraft/scoringEngine.ts` (definition / queue job name); callers orchestrate via same module / jobs — search for **imports** of `@/lib/redraft/scoringEngine` in `app/` for HTTP entry points |
| **`updateStandings`** | `lib/redraft/standingsEngine.ts` |
| **`runScoringWorker`** | `app/api/redraft/score-sync/route.ts`, `lib/workers/league-engine-worker.ts`, `lib/workers/scoring-worker.ts` |
| **`import-scores`** (string) | `app/api/redraft/score-sync/route.ts` (comment: expects PGS from cron) — dedicated cron route may exist outside this snapshot |
| **`score-sync`** | `__tests__/redraft-multi-sport-route-parity.test.ts`, `app/api/redraft/score-sync/route.ts`, `lib/zombie/zombieAutomation.ts` |
| **`weeklyProcessor`** | `app/api/leagues/[leagueId]/scoring/process-week/route.ts`, `lib/category-scoring/types.ts`, `lib/scoring-defaults/queueLeagueScoringRecalc.ts`, `server/services/matchupEngine.ts`, `server/services/statCorrectionService.ts`, `server/services/weeklyProcessor.ts` |

### 2.9 Sleeper → `TeamPerformance` (import / bootstrap)

**`teamPerformance` upsert (examples):** `lib/league/sleeper-import-process.ts`, `lib/league-import/sleeper/SleeperLeagueCreationBootstrapService.ts` (also listed under §2.5).

Related import entry: `app/api/import-sleeper/route.ts`, `lib/league-import/LeagueCreationBootstrapService.ts`, `lib/league/sleeper-ranking-import.ts` (string / wiring; confirm per-file for writes).

### 2.10 `ingestSportStats`

`lib/schedule-stats/StatIngestionService.ts` (definition and `prisma.playerGameStat.upsert`).

---

## 3. Writers / readers / cadence (ownership table)

| Store / artifact | Primary writers (in-repo) | Primary readers | Typical cadence | Intended role | Actual risk |
|------------------|---------------------------|-----------------|-----------------|----------------|-------------|
| **PlayerGameStat** | `StatIngestionService.ingestSportStats` → `prisma.playerGameStat.upsert` | `MultiSportMatchupScoringService`, `scoring-engine` path via worker, best-ball, trends, warehouse | Ingest cron / API when routes deployed | **Canonical game-level** normalized stats for AF ingest pipeline | Stale if ingest week ≠ fantasy week; provider delay |
| **PlayerWeeklyScore** | **Manual guarded** `upsert` in `lib/scoring/player-weekly-score-rollup.ts` when **`writeApplied`** (Phase 7E/7F); prior discovery found **no** other main-line Prisma writers | `weeklyProcessor`, `redraft/scoringEngine`, C2C/devy/bestball/guillotine/survivor, `server/services/scoringEngine` (comments) | **Opaque** + optional **manual** rollup | Weekly **rollup** for engines that bypass PGS | **Highest drift risk** + **global key** cross-league overwrite (Appendix G) |
| **TeamPerformance** | `scoreLeagueWeek` (`scoring-engine`), Sleeper import paths | League APIs, AI/matchup helpers, survivor/zombie, warehouse | `runScoringWorker` / score-sync; import | **Derived** week points (PGS **or** Sleeper) | **Dual writer** (AF scoring vs Sleeper) without explicit policy |
| **WeeklyScore / TeamWeekResult** | `processLeagueWeek` | `standingsEngine`, matchup engine | `process-week` API, stat correction queue | **Derived** ledger for weekly processor | Tied to PWS freshness |
| **RedraftMatchup** (scores) | `updateMatchupScores` / C2C parallel in `lib/c2c/scoringEngine.ts` | Redraft APIs, standings, zombie/tournament helpers | Cron / automation / manual | **Canonical** redraft H2H **record** | Scores fed from **PWS**, not PGS → split-brain vs `TeamPerformance` |
| **RedraftRoster** (standings) | `updateStandings` (`standingsEngine`) from **final** matchups | Redraft UI | After score-lock / automation | **Derived** W/L, PF, PA | Wrong if matchups never finalized or PWS wrong |

---

## 4. Source-of-truth matrix (summary)

| Entity | Canonical? | Derived? | Cache / materialized? | Imported snapshot? | User-visible? | Eventually consistent? |
|--------|------------|----------|------------------------|---------------------|-----------------|---------------------------|
| **PlayerGameStat** | **Yes** (game-level ingest path) | No | No | No | Rarely direct | Yes |
| **PlayerWeeklyScore** | **Derived (guarded)** — manual rollup job + possible external writers | Often treated as rollup | Possibly | Possible | Indirect | Unknown cross-league |
| **TeamPerformance** | No | **Yes** | Per-week materialization | Sleeper path | Yes | Yes |
| **WeeklyScore / TeamWeekResult** | No | **Yes** | Week slice | No | Via standings | Yes |
| **RedraftMatchup** | **Yes** (H2H row) | Score cells from PWS | No | No | Yes | Yes |
| **RedraftRoster** | No | **Yes** | No | No | Yes | After lock |
| **LeagueTeam** (PF/rank from worker) | No | **Yes** | No | Imports may touch | Yes | Yes |

**Uncomfortable truth:** **PGS** is the best-defined **ingest** substrate; **PWS** feeds **redraft matchup scoring** and **weeklyProcessor**. Main-line discovery found **no** legacy Prisma PWS writer; **Phase 7E/7F** adds a **guarded manual rollup** (`runPlayerWeeklyScoreRollup`) — see **Appendix F/G**. **PWS** remains **globally keyed**; **no** single cross-league scoring truth without schema or policy (Appendix G §G.2).

---

## 5. Data flow summary

1. **External stats** → **`ingestSportStats`** → **`PlayerGameStat`** (normalized map + optional precomputed fantasy points).
2. **`runScoringWorker`** → **`scoreLeagueWeek`** → reads **PGS** via multi-sport scorer → **`TeamPerformance`** + **`LeagueTeam`** aggregates (+ snapshots as implemented).
3. **Sleeper import** → may **`teamPerformance.upsert`** from platform scores (parallel truth for integrated leagues).
4. **Unknown / external path** → **`PlayerWeeklyScore`** population (required by downstream).
5. **`updateMatchupScores`** (redraft) → reads **PWS** for starters → writes **`RedraftMatchup`** scores.
6. **`processLeagueWeek`** → reads **PWS** → writes **`WeeklyScore` / `TeamWeekResult`**, resolves matchups, **`recomputeStandingsForSeason`**.
7. **`updateStandings` (redraft)** → reads **final** **`RedraftMatchup`** → **`RedraftRoster`**.

**`app/api/redraft/score-sync/route.ts`** orchestrates **`runScoringWorker`** (PGS path) and **Survivor** bridge (PWS-dependent `syncWeeklyScores`), plus zombie/C2C side effects — see file comments for ordering assumptions.

---

## 6. Split-brain & drift risks

| Risk | Mechanism |
|------|-----------|
| **Split-brain** | Same week: **`TeamPerformance`** fresh from **PGS** while **`RedraftMatchup`** stale from **PWS**. |
| **Stale redraft UI** | **PWS** empty or not updated → **`updateMatchupScores`** yields 0 or old totals. |
| **Stale category / processor standings** | **`processLeagueWeek`** not run or **PWS** missing → empty **`WeeklyScore`**. |
| **Dual `TeamPerformance` writers** | **`scoreLeagueWeek`** vs **Sleeper import** — last write wins unless keyed by source or disabled per league. |
| **Partial cron success** | **`import-scores`** (when deployed) succeeds but **`score-sync`** fails mid-run → uneven surfaces. |
| **Week mismatch** | Ingest targeting wrong `weekOrRound` vs **Phase 7B** resolved scoring week. |
| **No PGS↔PWS invariant** | No job proves **Σ(PGS-derived points) ≈ `PlayerWeeklyScore.fantasyPts`** for overlapping keys. |
| **Replay gaps** | No transactional link **PGS write → PWS rollup** in one unit of work. |

---

## 7. Recommended canonical direction (long-term)

1. **Keep `PlayerGameStat`** as the **single game-level ingest fact** (normalized stats) across supported sports.
2. **Make `PlayerWeeklyScore` explicitly derived** — one owned rollup job (from PGS + league rules), with **documented** cron and idempotency; **eliminate** opaque writers.
3. **Unify fantasy point math** — one shared helper for **multi-sport roster scoring** and **redraft starter sums** to avoid rule drift.
4. **`RedraftMatchup` / `TeamPerformance`** — either feed both from the same rollup or document **which surface is user-truth** per product (never both silently).
5. **Sleeper** — treat **`TeamPerformance`** from import as **snapshot**; gate **`scoreLeagueWeek`** per `platform` / league policy (future schema or feature flag).

---

## 8. Migration strategy (evolutionary — no big bang)

| Phase | Action |
|-------|--------|
| **A — Discover** | Locate **PWS** population (external worker, DB trigger, one-off script, or missing). Add **docs + logs at writer** only. |
| **B — Observe** | Read-only **drift probe** (sample players/weeks): PGS-derived vs PWS (no writes). |
| **C — Derive** | Introduce **rollup job** writing PWS from PGS; run **shadow** compare before cutover. |
| **D — Converge reads** | Optionally have **`updateMatchupScores`** read shared calculator from PGS or from **new** PWS; avoid dual rule paths. |
| **E — Policy** | Sleeper vs AF **`TeamPerformance`** conflict resolution. |

Do **not** merge tables or delete **PWS** until **B/C** prove parity.

---

## 9. Observability gaps (planned)

| Gap | Suggested signal / check |
|-----|--------------------------|
| PWS writer invisible | Metric + structured log at writer; until found, **count** PWS rows per `(sport, season, week)` vs PGS |
| PGS vs PWS drift | `stat_substrate_drift` counter from sampled compare |
| Redraft vs generic | Compare last update timestamps on **`TeamPerformance`** vs **`RedraftMatchup`** (confirm schema `updatedAt`) |
| Sleeper vs AF | Flag `platform === 'sleeper'` when both import and **`runScoringWorker`** can write **`TeamPerformance`** |
| Cron partial failure | **`score-sync`** response already aggregates worker + bridges — extend with **per-stage** success counts |

---

## 10. Recommended Phase 7D / 7E / 7F / 7G / 7H / 7I handoff

**Done in Phase 7D (Appendix E):** PWS writer discovery (no main-line Prisma writes); **`runStatDriftProbe`** + optional internal GET route + tests.

**Done in Phase 7E (Appendix F):** Wide writer discovery (still **no** legacy in-repo Prisma writer); **`runPlayerWeeklyScoreRollup`** with **dry-run default** and guarded **`write: true`** upserts; CLI + **`npm run rollup:player-weekly-scores`**; tests. **User-facing reads unchanged.**

**Done in Phase 7F (Appendix G):** Cross-league collision audit; **write-mode safety classification**; **guardrails** (`allowGlobalOverwrite`, `allowCustomScoringWrite`, structured logs); staging dry-run checklist; tests. **Still do not schedule** rollup writes from cron.

**Done in Phase 7G:** Architecture decision documented in `docs/league-scoped-weekly-score-architecture.md` with options A/B/C/D analysis, recommendation, league-scoped schema proposal (no migration applied), evolutionary migration plan, and consumer impact audit.

**Done in Phase 7H (safe prep only):**

1. Draft Prisma model `LeaguePlayerWeeklyScore` added to `prisma/schema.prisma` (no migration applied).  
2. Draft SQL in `docs/sql/league-player-weekly-score-migration-draft.sql` (includes rollback note).  
3. Shadow writer interface added: `lib/scoring/league-player-weekly-score-store.ts` (write disabled by default; explicit `allowShadowWrite` required).  
4. Read precedence contract helper added: `lib/scoring/weekly-score-read-precedence.ts` (league-scoped -> global allowed contexts -> explicit compute fallback).  
5. Tests added: `__tests__/league-player-weekly-score-store.test.ts` (candidate shape, unique key assumptions, dry-run/write guard, precedence no-global-fallback when scoped required).

**Done in Phase 7I (staging preparation only):**

1. Migration safety reviewed and staged SQL kept in `docs/sql/league-player-weekly-score-migration-draft.sql` with rollback note.  
2. Prisma adapter added: `lib/scoring/league-player-weekly-score-prisma-adapter.ts` (composite upsert, create/update/skip counts, finalize preservation).  
3. Shadow telemetry added in `lib/scoring/league-player-weekly-score-store.ts`: `shadow_write_started/completed/blocked/failed`, `duplicate_candidate_keys`, `scoring_rules_hash_missing`.  
4. Read-precedence telemetry signal added: `global_fallback_prevented` when league-scoped required path intentionally blocks global fallback.  
5. Staging-only script added: `scripts/run-league-player-weekly-score-rollup.ts` + npm command `rollup:league-player-weekly-scores`; write requires both `--shadowWrite` and `--confirmStaging`.  
6. No consumer switches, no schedule changes, no production writes enabled.

**Done in Phase 7J (staging canary planning + parity gate tooling):**

1. Added canary/parity evaluator module: `lib/scoring/league-player-weekly-score-canary.ts`.
   - Defines canary selection requirements.
   - Produces normalized canary summary output shape.
   - Enforces parity gate fail/pass checks (drift threshold, missing stats allowance, duplicate key allowance, hash-doc gate, fallback anomaly gate, UI mismatch gate).
2. Added safe wrapper script: `scripts/run-league-score-canary.ts` + npm command `rollup:league-score-canary`.
   - Always runs dry-run candidate build + drift probe.
   - Optional shadow write requires `--shadowWrite --confirmStaging`.
   - Exits non-zero when parity gate fails.
3. Expanded shadow telemetry payload contract in `lib/scoring/league-player-weekly-score-store.ts`.
   - Added explicit `writeRequested` and `writeApplied` state.
   - Preserves existing canary review counters (`candidateCount`, `duplicateInputCount`, `scoringRulesHashMissingCount`, write counts, duration, league/week scope).
4. Added tests for parity gate and canary summary:
   - `__tests__/league-player-weekly-score-canary.test.ts`
   - Covers pass/fail thresholds and staging write safety gate.
5. Updated runbook and gate criteria in `docs/league-scoped-weekly-score-architecture.md` (Phase 7J section).

**Done in Phase 7K (controlled staging canary execution prep + read-path canary plan):**

1. Added positive staging-environment guard:
   - `lib/scoring/staging-environment-guard.ts`
   - `scripts/run-league-score-canary.ts` now blocks shadow writes unless both:
     - `--confirmStaging` is present
     - staging environment is positively confirmed from env signals
2. Added read-path feature-flag planning helper:
   - `lib/scoring/league-scoped-weekly-score-read-flag.ts`
   - Supports `LEAGUE_SCOPED_WEEKLY_SCORE_READS=off|internal|canary|on` parsing and scoped-read eligibility planning.
3. Captured canary command behavior in workspace:
   - Dry run emitted JSON summary packet.
   - Shadow-write attempt correctly refused with `staging_environment_not_confirmed`.
4. Added tests for Phase 7K controls:
   - `__tests__/staging-environment-guard.test.ts`
   - `__tests__/league-scoped-weekly-score-read-flag.test.ts`
   - updated `__tests__/league-player-weekly-score-canary.test.ts` for non-staging write refusal.
5. Updated architecture runbook docs with:
   - execution record,
   - pending staging checklist,
   - rollback ownership/SLA,
   - Phase 7L go/no-go criteria.

**Phase 7L (recommended next):**

1. Confirm staging identity explicitly (environment label + DB ownership + backup ticket).  
2. Apply staging migration and run real canary league/week set with parity packet artifacts.  
3. Launch first internal-only diagnostic read-path canary behind `LEAGUE_SCOPED_WEEKLY_SCORE_READS=internal`.  
4. Keep user-facing reads unchanged until canary trend and rollback drills pass.

---

## Appendix A — Textual reconciliation flow (target state)

```
                    ┌─────────────────────┐
                    │  Provider APIs      │
                    └─────────┬───────────┘
                              │
                              v
                    ┌─────────────────────┐
                    │  ingestSportStats   │
                    │  PlayerGameStat     │◄──── canonical game-level
                    └─────────┬───────────┘
                              │
              ┌───────────────┼───────────────┐
              v               v               v
   ┌──────────────────┐  ┌─────────────┐  ┌─────────────────────┐
   │ Rollup job (new) │  │scoreLeague  │  │ Shared calculator  │
   │ PlayerWeeklyScore│  │Week / Team  │  │ (rules)             │
   │  (derived)       │  │Performance  │  └──────────┬──────────┘
   └────────┬─────────┘  └──────┬──────┘             │
            │                   │                     v
            v                   │           ┌─────────────────┐
   ┌──────────────────┐        │           │updateMatchup    │
   │ processLeagueWeek│        │           │Scores           │
   │ WeeklyScore /    │        │           │ RedraftMatchup  │
   │ TeamWeekResult   │        │           └─────────────────┘
   └──────────────────┘        │
                               v
                        LeagueTeam (PF)
```

Today, the **rollup job** box is **not implemented in main-line TS**; consumers still assume **PWS** exists.

---

## Appendix B — Operational / debugging guidance

| Symptom | Check first | Likely cause |
|---------|-------------|--------------|
| Redraft matchup **0–0** | **PWS** for starters that week | PWS empty / stale |
| Hub points ≠ redraft tab | **`TeamPerformance`** vs **`RedraftMatchup`** | Dual substrate |
| Category standings wrong | **`processLeagueWeek`**, **`TeamWeekResult`** | PWS / processor |
| Sleeper totals odd | `platform`, import vs **`runScoringWorker`** | Dual **`TeamPerformance`** writer |

**Recovery (existing patterns):** `process-week` API with explicit `{ season, week }`; redraft **`score-lock`** with explicit season/week where applicable.

---

## Appendix C — Build validation (Phase 7C)

**Command (PowerShell):** `$env:NODE_OPTIONS="--max-old-space-size=16384"; npm run build`

**Interpretation:** Prior runs without enough heap failed with **exit 134** and **JavaScript heap out of memory** (~8 GB observed). **Raising `NODE_OPTIONS`** addresses **resource limits**, not TypeScript correctness. **Do not** loop full builds without more heap or narrower compile targets.

**Recorded run (Phase 7C):** `npm run build` with **`NODE_OPTIONS=--max-old-space-size=16384`** completed with **`EXIT=0`** (~31 minutes wall time; `vercel-next-build` restore/exclude churn in log). Earlier failures at **~8 GB** were **heap OOM (exit 134)** — resource class, not proof of bad sources. If **134** persists at 16 GB, treat as **host RAM ceiling** or narrow the build surface.

**Recorded run (Phase 7D, post drift-probe):** Same heap setting — **`exit_code: 0`**, ~**24 minutes** (log tail dominated by `vercel-next-build` route restores).

---

## Appendix D — Safe improvements already applied (Phase 7C)

- This document (iterative expansion + `git grep` inventory).
- Pointer comments in `MultiSportMatchupScoringService.ts` and `StatIngestionService.ts`.
- Cross-links: `docs/scoring-week-resolution.md`, `docs/league-gameplay-lifecycle-audit-phase7a.md` §9b.

---

## Appendix E — Phase 7D: `PlayerWeeklyScore` writer discovery & drift probe

### E.1 Writer discovery (Windows-safe, main-line tree)

**Searches performed:** `git grep` / scoped ripgrep for:

- `prisma.playerWeeklyScore.(create|createMany|upsert|update|updateMany)`
- `playerWeeklyScore:` / `PlayerWeeklyScore` in `app/`, `lib/`, `server/`, `prisma/`, `scripts/`
- SQL: `INSERT INTO "PlayerWeeklyScore"` / `player_weekly_score` in `prisma/migrations`

**Result — Prisma writes in main-line TS (`lib/`, `app/`, `server/`):** **None found.**  
No `create`, `upsert`, `update`, or `updateMany` on `playerWeeklyScore` appears in application code under those directories.

**Readers (confirmed):** `lib/redraft/scoringEngine.ts` (`updateMatchupScores`), `server/services/weeklyProcessor.ts`, C2C/devy/bestball/guillotine/survivor modules, `lib/survivor/survivorScoringPipeline.ts` (optional chaining read).

**Schema:** `prisma/schema.prisma` defines model `PlayerWeeklyScore` → table `player_weekly_scores` (migration `20260407024117_init` creates table only).

**Other locations:** `scripts/` — no hits. `supabase/functions` — not present in repo. **Classification:** writer is **external / legacy / not checked into this repo** (or manual DB ops) until a pipeline is located in another service or branch.

### E.2 Read-only drift probe

| Item | Detail |
|------|--------|
| **Module** | `lib/scoring/stat-drift-probe.ts` — `runStatDriftProbe({ leagueId, season, week, matchupId?, jobName? })` |
| **Mutations** | **None** — read-only Prisma `find*` only |
| **Scope** | One **redraft** matchup (`scheduled` / `active`) for the season year + week; compares **starter** sums: **PWS** vs **PGS-derived** (`computeRosterScoreForWeek`), and **RedraftMatchup** score vs PGS sum; best-effort **`TeamPerformance`** vs PGS when `LeagueTeam` resolves by `externalId` |
| **Skips** | **C2C** leagues — returns early with note (matchup scoring path differs). **Devy** — per-player PGS vs PWS comparison skipped (`updateMatchupScores` uses official devy path); team PGS row omitted |
| **Logs (stdout JSON)** | `stat_drift_probe_started`, `stat_drift_probe_completed`, `stat_drift_detected` (when `severity !== 'none'` or mismatches), `stat_drift_probe_failed` |

### E.3 Optional internal HTTP surface

| Item | Detail |
|------|--------|
| **Route** | `GET /api/internal/scoring/stat-drift-probe?leagueId=&season=&week=&matchupId=` |
| **Auth** | Header **`x-internal-key`** must equal **`process.env.SESSION_SECRET`** (same pattern as `app/api/internal/analyze-trades/route.ts`). Returns **503** if secret unset. |
| **Response** | JSON including `disclaimer` — diagnostic only, no PII by design (IDs and numeric aggregates only). |
| **Deploy note** | `scripts/vercel-next-build.cjs` **excludes** `app/api/internal/**` from the production route bundle — route is for **dev / self-hosted / CI** runs, or call **`runStatDriftProbe`** directly from workers. |

### E.4 Tests

`__tests__/stat-drift-probe.test.ts` — severity thresholds, `runStatDriftProbe` early exits, C2C skip, structured log strings, no mutation stubs.

### E.5 Handoff to Phase 7E / 7F

Phase 7E adds an **in-repo derived rollup** (dry-run + guarded write) — see **Appendix F**. Phase **7F** adds collision audit + **write guardrails** — see **Appendix G**.

---

## Appendix F — Phase 7E: `PlayerWeeklyScore` rollup ownership & safe writes

### F.1 Final writer discovery (wide pass)

| Area | Patterns | Result |
|------|-----------|--------|
| **`*.ts` / `*.tsx`** | `prisma.playerWeeklyScore.(create\|upsert\|update\|createMany\|updateMany)` | **No matches** in `lib/`, `app/`, `server/` |
| **`package.json` scripts** | `PlayerWeeklyScore` / `playerWeeklyScore` | **No** rollup references before Phase 7E |
| **`scripts/`** | `playerWeeklyScore` | **No** writers |
| **SQL / Supabase dumps** | `player_weekly_scores`, `PlayerWeeklyScore` | **DDL / schema only** (`prisma/migrations/...`, `supabase_*.sql`) — not application writers |
| **Generated / build** | `.next*` bundles | **Prisma client reads only** — ignore for ownership |
| **Classification** | — | **Actual in-repo writer:** **none**. **Possible external writer:** ops/ETL/another service. **Readers:** unchanged (Phase 7D list). |

### F.2 Ownership decision

- **`PlayerGameStat`** remains the **canonical ingest fact** (per game).
- **`PlayerWeeklyScore`** is treated as a **derived global rollup** keyed by `@@unique([playerId, week, season, sport])` — **not league-scoped in the schema**.
- **Rollup implementation** uses the **input `leagueId`’s scoring rules** (`computePlayerFantasyPoints` + league settings) but **writes the global row**. Operators must avoid conflicting writes when multiple leagues disagree on the same `(playerId, week, season, sport)` (e.g. custom scoring leagues sharing NFL players).

### F.3 Module: `lib/scoring/player-weekly-score-rollup.ts`

| Concern | Behavior |
|---------|----------|
| **Determinism** | Same PGS rows + same league rules → same computed points (rounded to 2 dp). |
| **Idempotency** | `upsert` on `playerId_week_season_sport`; skip when within **0.01** pts of existing. |
| **Scope** | **Matchup-week starters** for the league: all `RedraftMatchup` rows for `(leagueId, redraftSeason.season, week)` → union of non-bench/taxi/devy `RedraftRosterPlayer` rows. |
| **Dry-run (`write: false`, default)** | Computes `candidateRows`, `missingPlayers`, `wouldCreate` / `wouldUpdate` / `wouldSkip`, **`writtenCreate`/`writtenUpdate` = 0** — **no** `$transaction`. |
| **Write (`write: true`)** | **Phase 7F:** requires **`allowGlobalOverwrite: true`** (API) or CLI **`--allowGlobalOverwrite`** with **`--write`**. If the league has **scoring deviation** (any `LeagueScoringOverride` **or** effective format ≠ sport `defaultFormat` from `SportRegistry`), also requires **`allowCustomScoringWrite`** / **`--allowCustomScoringWrite`**. Otherwise writes are skipped (`writeApplied: false`, notes explain). Successful writes log **`globalRowCollisionNote`**. |
| **Logs** | `pws_rollup_started`, `pws_rollup_dry_run_completed`, `pws_rollup_write_completed` (includes collision acknowledgement), `pws_rollup_write_blocked`, `pws_rollup_write_not_applied`, `pws_rollup_failed`. |

### F.4 CLI (not scheduled)

- **Script:** `scripts/run-player-weekly-score-rollup.ts`
- **npm:** `npm run rollup:player-weekly-scores -- --leagueId <id> --season 2025 --week 5` (**dry-run**, default).
- **Writes:** `--write --allowGlobalOverwrite` (+ `--allowCustomScoringWrite` when Appendix G risk flags fire). Script **exits 2** if `--write` without `--allowGlobalOverwrite`, or if write was requested but **`writeApplied`** is false.
- **Scheduling:** **not wired** — run manually until ownership + collision policy is signed off (Appendix G).

### F.5 Tests

`__tests__/player-weekly-score-rollup.test.ts` — `mergeNormalizedStatMaps`, `classifyRollupRowAction`, `evaluateScoringDeviationsFromSignals`, dry-run skips `$transaction` and **write-guard** Prisma reads, Phase **7F** guardrails (`allowGlobalOverwrite` / `allowCustomScoringWrite`), transactional `upsert` when writes apply.

### F.6 Future migration / Phase 7G+

See **Appendix G** (Phase 7F complete) and **§10 Phase 7G** for collision policy, optional HTTP trigger, and schema direction.

### F.7 Build validation (Phase 7E)

Re-run: `$env:NODE_OPTIONS="--max-old-space-size=16384"; npm run build` after merging rollup code (expect same **heap** guidance as Appendix C).

---

## Appendix G — Phase 7F: cross-league collision audit & write guardrails

### G.1 Collision audit (would League A overwrite League B?)

**Schema:** `PlayerWeeklyScore` is unique on `(playerId, week, season, sport)` — **no `leagueId`**.

**How rollup computes points:** For each starter in League A’s matchup week, merged `PlayerGameStat.normalizedStatMap` is passed to **`computePlayerFantasyPoints(leagueId_A, …)`** → **`resolveScoringRulesForLeague`** → **`getLeagueScoringRules(leagueId_A, sportType, format)`**, which loads the **template for `formatType`** and merges **`LeagueScoringOverride` rows for `leagueId_A` only** (`lib/multi-sport/ScoringTemplateResolver.ts`). `League.settings` / `leagueVariant` / `scoring_format` / IDP preset (`getLeagueSettingsForScoring`) influence the resolved format.

**Can two leagues disagree on the same keys?** **Yes.** Examples: League A **Half PPR**, League B **Full PPR**; League A **custom overrides** on passing TDs, League B none; League A **IDP-balanced**, League B **standard**; dynasty vs redraft can differ if **settings/overrides** differ. **Redraft vs dynasty** does not change the math by itself — only if **resolved rules** differ.

**Conclusion:** A rollup write from **League A** persists fantasy points computed with **A’s rules** into the **global** row. If **League B** needs a different total for the same `(playerId, week, season, sport)`, **B’s correctness is overwritten** until another writer runs. **No** in-repo check proves all leagues share identical rules.

### G.2 Write-mode safety classification (conservative)

| Option | Verdict |
|--------|---------|
| **A. Safe globally** | **No** — multi-league platforms can have divergent templates/overrides. |
| **B. Safe only for standardized presets** | **Partially** — only if **all** active leagues that ever consume that row share the **same** effective rules (unenforced here). |
| **C. Unsafe without league-keyed schema** | **Yes** — this is the accurate product statement for divergent scoring. |
| **D. Unknown** | **Rejected** — collision mechanism is clear from code + schema. |

**Default operational stance:** treat **DB writes as `C`** unless operators have **external** proof of single-profile use (e.g. one league per environment, or a platform-wide scoring lock).

### G.3 Guardrail behavior (implemented)

| Mode | Behavior |
|------|----------|
| **Dry-run** | Always allowed; **no** `allowGlobalOverwrite` / `allowCustomScoringWrite` required; **no** `$transaction`. |
| **Write** | Blocked unless **`allowGlobalOverwrite`** is true (acknowledges global last-writer-wins). |
| **Write + league scoring deviation** | Deviation = **any** `LeagueScoringOverride` for the league **or** resolved format ≠ sport **`defaultFormat`** (`DEFAULT_FORMAT_BY_SPORT` via `resolveSportConfigForLeague`). Blocked unless **`allowCustomScoringWrite`** is also true. |
| **Logs** | `pws_rollup_write_blocked`, `pws_rollup_write_not_applied`, and successful `pws_rollup_write_completed` include **`globalRowCollisionNote`** / `scoringRisk` metadata where applicable. |

**Not done (by design):** no cron, no automatic `--write`, no change to user-visible scoring math.

### G.4 Staging dry-run checklist (no local DB required)

When validating in staging or production-like data:

1. Pick a **redraft** `leagueId`, **season** (calendar year), **week** with scheduled matchups and starters.  
2. Run **dry-run:** `npm run rollup:player-weekly-scores -- --leagueId … --season … --week …`  
3. Inspect JSON: `wouldCreate` / `wouldUpdate` / `wouldSkip`, `missingPlayers`, `notes`.  
4. Run **`runStatDriftProbe`** (or internal GET drift-probe) for the same league/week — reconcile PGS vs PWS story **before** any write.  
5. If writes are justified, use **`--write --allowGlobalOverwrite`**; if JSON reports scoring risk, add **`--allowCustomScoringWrite`** only after explicit sign-off.  
6. Re-run drift / matchup UI checks for **other leagues** that share players that week (spot-check for overwritten PWS).

**Local dev without data:** rely on **`__tests__/player-weekly-score-rollup.test.ts`** (guard + pure signal helper).

### G.5 Tests

`__tests__/player-weekly-score-rollup.test.ts` — `evaluateScoringDeviationsFromSignals`, dry-run without flags, write blocked without `allowGlobalOverwrite`, write proceeds with flags when non-risky, blocked on overrides / non-default format unless `allowCustomScoringWrite`, override path with both allow flags.
