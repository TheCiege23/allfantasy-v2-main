# League-Scoped Weekly Player Score Architecture (Phase 7G)

**Date:** 2026-05-13  
**Status:** Architecture decision only (no migration run, no consumer cutover, no scheduler changes).  
**Scope guardrails:** Do not migrate production data, do not schedule writes, do not switch UI consumers, do not remove `PlayerWeeklyScore`.

---

## 1) Decision Context

- `PlayerGameStat` remains canonical ingest for game-level stats.
- `PlayerWeeklyScore` is globally keyed by `(playerId, week, season, sport)`.
- Phase 7F confirmed cross-league overwrite risk when scoring rules differ.
- Current rollup write mode is intentionally guarded and manual.
- Product requirements prioritize scoring correctness across custom scoring, leagues, and sports.

---

## 2) Architecture Options Analysis

| Option | Correctness | Performance | Migration complexity | Storage cost | Consumer impact | Custom scoring support | Multi-sport support | Closed-alpha suitability |
|---|---|---|---|---|---|---|---|---|
| **A. Keep global `PlayerWeeklyScore` with one global profile per sport** | **Low/conditional** (only correct if scoring is standardized and enforced) | High read performance | Medium (needs policy enforcement + guardrails) | Low | Low immediate change | Weak (conflicts with per-league customization) | Good if sport-level only | Weak fit (product supports custom scoring) |
| **B. Add league-scoped persisted scores (`LeaguePlayerWeeklyScore`)** | **High** (league-specific truth) | High reads after write; predictable | Medium-High (new model + phased writers/readers) | Medium-High | Medium (eventual reader migrations) | **Strong** | **Strong** | **Strong** |
| **C. Compute on demand from `PlayerGameStat` only** | High if deterministic path is shared | Variable; potentially expensive at peak | Medium (reader/query refactors, caching design) | Low persisted table cost | High (many read paths change) | Strong | Strong | Medium (risk under load unless caching mature) |
| **D. Hybrid: keep global cache + add league-scoped custom rows** | **High** if precedence rules are strict | High (cache hit path + league fallback) | **Highest** (dual-read/write semantics) | Highest | Medium-High (more logic per consumer) | **Strong** | **Strong** | **Best practical bridge** |

### Notes by option

- **Option A** conflicts with AllFantasy custom league scoring unless platform policy removes that flexibility.
- **Option B** is the cleanest correctness model and easiest to reason about long-term.
- **Option C** minimizes persisted tables but increases runtime cost and complexity in hot paths.
- **Option D** best balances near-term compatibility and long-term correctness while avoiding abrupt cutover.

---

## 3) Recommendation

**Recommend Option D (Hybrid), implemented in phases with Option B as the long-term center of truth.**

### Why

- Correctness-first requirement is non-negotiable for trust and league fairness.
- Existing ecosystem already reads `PlayerWeeklyScore`; immediate replacement is high risk.
- Hybrid supports gradual migration:
  - retain global standard-cache behavior where safe,
  - introduce league-scoped truth where scoring diverges.
- This keeps closed-alpha velocity while reducing cross-league corruption risk.

### Precedence policy (required)

Future reads should follow deterministic precedence:

1. If `LeaguePlayerWeeklyScore` exists for `(leagueId, playerId, season, week, sport)`, use it.
2. Else fall back to global `PlayerWeeklyScore` only when league is on approved standardized scoring profile.
3. Else compute from `PlayerGameStat` (or return reconciliation-needed signal in controlled internal surfaces).

---

## 4) Proposed Schema (proposal only, no migration yet)

**Model name:** `LeaguePlayerWeeklyScore`

Suggested fields:

- `id: String @id @default(cuid())`
- `leagueId: String`
- `playerId: String`
- `sport: String`
- `week: Int`
- `season: Int`
- `fantasyPts: Float @default(0)`
- `stats: Json` (lineage payload, merged stat map metadata, diagnostic source fields)
- `source: String` (e.g. `rollup_pgs`, `manual_override`, `import`)
- `lineageJobName: String?`
- `rollupVersion: Int?`
- `scoringProfileId: String?` (optional stable profile identifier)
- `scoringRulesHash: String?` (hash of resolved rules for change detection)
- `isFinalized: Boolean @default(false)`
- `createdAt: DateTime @default(now())`
- `updatedAt: DateTime @updatedAt`

Suggested constraints / indexes:

- `@@unique([leagueId, playerId, week, season, sport])`
- `@@index([leagueId, week, season, sport])`
- `@@index([playerId, sport, season, week])`
- `@@index([leagueId, updatedAt])`
- Optional: `@@index([leagueId, scoringRulesHash])` for audit/drift workflows.

---

## 5) Evolutionary Migration Plan (no prod migration in Phase 7G)

### Phase 1 — Schema + shadow writer

- Add new Prisma model only (migration reviewed, not auto-applied in Phase 7G).
- Add writer in shadow mode (write to new table behind explicit internal flag/runbook).
- Keep existing global flow unchanged.

### Phase 2 — Sampled backfill

- Backfill selected leagues/weeks/sports (include custom scoring leagues).
- Record rule hashes and source lineage for auditability.

### Phase 3 — Drift compare

- Compare:
  - `LeaguePlayerWeeklyScore` vs recomputed `PlayerGameStat`+rules,
  - existing consumer outputs vs league-scoped outputs.
- Report severity and confidence gates before any consumer cutover.

### Phase 4 — Switch one internal consumer

- Candidate first consumer: internal matchup/processor path with low blast radius.
- Ship with fallback and telemetry.

### Phase 5 — Expand reads

- Gradually move redraft matchup scoring, weekly processor, and selected optimizers/recommenders.
- Keep global fallback for standardized profiles during transition.

### Phase 6 — Deprecate unsafe global writes

- Disable global write paths for leagues with non-standard scoring.
- Keep global `PlayerWeeklyScore` as optional standard cache and backward-compat surface until deprecation criteria pass.

---

## 6) Likely Consumer Impact Audit (no migrations yet)

Likely readers that should eventually prefer league-scoped rows:

- **Matchups:** `lib/redraft/scoringEngine.ts`, `server/services/weeklyProcessor.ts`
- **Standings/weekly processing:** `server/services/weeklyProcessor.ts`, downstream standings engines
- **Best ball optimizer:** `lib/bestball/optimizer.ts`
- **Waiver/AI recommendation surfaces:** modules deriving weekly points context from PWS-backed paths
- **Player profile / modal contexts:** C2C/deep profile surfaces that currently read weekly points snapshots
- **Devy/C2C paths:** `lib/devy/scoringEligibilityEngine.ts`, `lib/c2c/scoringEngine.ts`
- **Survivor/guillotine flows:** `lib/survivor/*`, `lib/guillotine/eliminationEngine.ts`

Global readers can remain temporarily but should be categorized:

- **Category 1:** must be correctness-first (migrate earlier).
- **Category 2:** can tolerate cache fallback (migrate later).

---

## 7) Risks and Open Questions

### Risks

- Dual-table hybrid complexity can cause ambiguous precedence unless strictly enforced.
- Backfill volume may be large across leagues/sports/weeks.
- Rule hash stability requires deterministic serialization/versioning.
- Consumer drift if some surfaces still read global cache while others read league-scoped truth.

### Open questions

1. Should standardized leagues be explicitly tagged with a `scoringProfileId` contract?
2. Which internal consumer is safest for first cutover in Phase 4?
3. Is per-week finalization source of truth the matchup lock process or score ingestion process?
4. Do we need per-game lineage references in `stats` for forensic replay?
5. What retention policy applies to league-scoped rows for old seasons?

---

## 8) Phase 7H Recommendation

Phase 7H should execute **implementation planning artifacts only** (still no broad cutover):

1. Draft Prisma model + migration SQL for review (not applied automatically).
2. Add typed repository interface for weekly score reads with precedence contract (no consumer switch yet).
3. Add shadow writer interface and telemetry schema (`source`, `rulesHash`, `writeMode`).
4. Define rollout checklist and guardrails for first internal consumer canary.

---

## 9) Phase 7H Implementation Snapshot (safe prep only)

### 9.1 Prisma schema draft status

- Added draft model to `prisma/schema.prisma`:
  - `LeaguePlayerWeeklyScore`
  - relation to `League` via `leagueId`
  - constraints/indexes:
    - `@@unique([leagueId, playerId, week, season, sport])`
    - `@@index([leagueId, season, week])`
    - `@@index([playerId, season, week, sport])`
    - `@@index([leagueId, updatedAt])`
- Added back relation list on `League`:
  - `leaguePlayerWeeklyScores LeaguePlayerWeeklyScore[]`
- `Player` relation intentionally deferred: current schema does not consistently use `Player` FK relations across weekly score surfaces, so forcing a relation now could create false coupling before identity contract review.

### 9.2 Migration draft status (not applied)

- Draft SQL created at:
  - `docs/sql/league-player-weekly-score-migration-draft.sql`
- Includes create table, indexes, FK to `leagues`, and rollback draft (`DROP TABLE IF EXISTS`).
- No Prisma migration command executed in Phase 7H.

### 9.3 Shadow writer interface status

- Added `lib/scoring/league-player-weekly-score-store.ts`:
  - typed candidate builder (`buildLeaguePlayerWeeklyScoreCandidate`)
  - batch candidate builder + dedupe (`buildLeaguePlayerWeeklyScoreCandidates`)
  - composite key helper (`toLeaguePlayerWeeklyScoreKey`)
  - shadow persist orchestrator (`persistLeaguePlayerWeeklyScoreCandidates`)
- Safety defaults:
  - dry-run default (`write` false)
  - write blocked unless `allowShadowWrite: true`
  - write requires injected adapter; no direct consumer switch
  - idempotent contract represented by `upsertMany` adapter interface

### 9.4 Read precedence contract status

- Added `lib/scoring/weekly-score-read-precedence.ts`:
  - `resolveWeeklyScoreReadDecision(...)`
  - enforced contract:
    1. league-scoped score first
    2. global score only in allowed standard contexts
    3. compute fallback only when explicitly requested
  - disallows global fallback when `leagueScopedRequired` is true.

### 9.5 Still intentionally not done

- No consumer read switch.
- No scheduler/cron changes.
- No production data mutation.
- No deletion/deprecation of `PlayerWeeklyScore`.

---

## 10) Phase 7I Staging Migration + Prisma Adapter + Telemetry

### 10.1 Migration safety review

Reviewed draft model and SQL against Phase 7H/7I constraints:

- Table mapping is consistent: Prisma `@@map("league_player_weekly_scores")` ↔ SQL table name.
- Composite unique key is correct for league-scoped correctness:
  - `(leagueId, playerId, week, season, sport)`.
- Required indexes are present:
  - `(leagueId, season, week)`,
  - `(playerId, season, week, sport)`,
  - `(leagueId, updatedAt)` for operational scans.
- League FK is valid and cascades deletes with league lifecycle.
- No `Player` FK was introduced (intentionally deferred pending identity contract review).
- Nullable lineage fields are intentional (`stats`, `lineageJobName`, `rollupVersion`, `scoringProfileId`, `scoringRulesHash`).
- Timestamp defaults are correct (`createdAt default now`, `updatedAt` managed by Prisma updates).

### 10.2 Staging apply instructions (not production)

1. **Generate Prisma client for new model types (safe mode if engine lock exists):**  
   `npx prisma generate --schema prisma/schema.prisma --no-engine`
2. **Preferred staging migration command (reviewed SQL path):**  
   `prisma db execute --file docs/sql/league-player-weekly-score-migration-draft.sql --schema prisma/schema.prisma`
3. **Rollback (staging only):** run the rollback statement documented in the SQL draft:
   `DROP TABLE IF EXISTS "league_player_weekly_scores";`

Production prohibition: no automatic production apply, no scheduler wiring, no consumer cutover.

### 10.3 Prisma adapter status

Added Prisma-backed adapter:

- File: `lib/scoring/league-player-weekly-score-prisma-adapter.ts`
- Class: `PrismaLeaguePlayerWeeklyScoreAdapter`
- Behavior:
  - accepts `LeaguePlayerWeeklyScoreCandidateRow[]`
  - deduplicates by composite key
  - loads existing rows for create/update/skip classification
  - upserts by composite unique key
  - preserves finalized state when already finalized
  - returns `{ wroteRows, writtenCreate, writtenUpdate, skipped }`

### 10.4 Shadow write telemetry

Added structured event telemetry in `persistLeaguePlayerWeeklyScoreCandidates`:

- `shadow_write_started`
- `shadow_write_completed`
- `shadow_write_blocked`
- `shadow_write_failed`
- `duplicate_candidate_keys`
- `scoring_rules_hash_missing`

Plus read-contract telemetry:

- `global_fallback_prevented` emitted by read-precedence helper when league-scoped is required and global fallback is intentionally denied.

Payload design includes: `leagueId`, `season`, `week`, `candidateCount`, write counts, `durationMs`, `jobName`; no player names/PII.

### 10.5 Staging-only script mode

Added script and npm command:

- Script: `scripts/run-league-player-weekly-score-rollup.ts`
- npm: `npm run rollup:league-player-weekly-scores -- --leagueId ... --season ... --week ... [--dryRun|--shadowWrite --confirmStaging]`

Safety gates:

- default dry-run
- write blocked unless both `--shadowWrite` and `--confirmStaging`
- explicit warning output on shadow write
- no cron/schedule integration

### 10.6 Prisma generate note

On Windows, normal `npm run prisma:generate` may fail if query engine DLL is locked by running Node/Next processes.  
Fallback used in Phase 7I: `npx prisma generate --no-engine`, which updates client types without binary replacement.

---

## 11) Phase 7J — Staging Canary + Parity Gate Plan (no cutover)

**Status:** Planning + tooling only.  
**Still not allowed in Phase 7J:** production migration apply, user-facing read cutover, scheduled writes, removal of global `PlayerWeeklyScore`, assumption that `scoringRulesHash` policy is complete.

### 11.1 Staging-only migration runbook

1. **Preflight backup/checkpoint**
   - Confirm target DB is staging (connection string, environment label, approval).
   - Capture checkpoint: table row counts, migration status, and backup/snapshot reference.
2. **Apply migration SQL (staging only)**
   - Command: `prisma db execute --file docs/sql/league-player-weekly-score-migration-draft.sql --schema prisma/schema.prisma`
   - Do not run in production in Phase 7J.
3. **Prisma client generation if needed**
   - Preferred: `npx prisma generate --schema prisma/schema.prisma --no-engine` (safe when engine file is locked).
4. **Dry-run rollup candidate build**
   - Command: `npm run rollup:league-player-weekly-scores -- --leagueId <id> --season <yyyy> --week <n> --dryRun`
5. **Shadow-write canary (staging-only, explicit)**
   - Command: `npm run rollup:league-score-canary -- --leagueId <id> --season <yyyy> --week <n> --shadowWrite --confirmStaging`
6. **Drift probe + summary compare**
   - `run-league-score-canary` includes drift probe and parity evaluation in one output JSON.
   - Compare against current matchup/UI totals before any read-path experiments.
7. **Rollback procedure (staging)**
   - Stop canary writes.
   - Execute rollback SQL: `DROP TABLE IF EXISTS "league_player_weekly_scores";`
   - Re-run dry-run canary to confirm no write path applies.
8. **Go / no-go checklist**
   - Migration applied in staging only.
   - Parity gate passes for selected canary league/week samples.
   - No unexpected write failures, duplicate key anomalies, or fallback anomalies.

### 11.2 Canary selection criteria

Select canary samples in staging with this minimum mix:

- One standard-scoring redraft league.
- One custom-scoring redraft league (if present in staging).
- One league/week with finalized matchups.
- One league/week with known missing stats (if available).
- One recent active week.

If staging lacks one or more categories, log explicit fallback notes in the canary report:

- `fallback_missing_custom_scoring_sample`
- `fallback_missing_missing-stats_sample`
- `fallback_reused_recent_active_week`

### 11.3 Parity gate thresholds (pass/fail)

Phase 7J gate fails if any of the following are true:

- Missing `PlayerGameStat` count is above documented expected allowance.
- Team-level drift (`RedraftMatchup` vs PGS / `TeamPerformance` vs PGS) exceeds **0.02**.
- Shadow write is requested but not applied (write failure/blocked in a write-requested run).
- Duplicate candidate key count exceeds documented expected dedupe allowance.
- `scoringRulesHash` missing count is non-zero and not explicitly documented.
- Unexpected global fallback count is non-zero.
- Team-level mismatch indicates current UI score regression risk.

### 11.4 Telemetry requirements for canary review

Canary logs must include:

- `candidateCount`
- `writeRequested` / `writeApplied`
- `writtenCreate` / `writtenUpdate`
- `skipped`
- `duplicateInputCount`
- `scoringRulesHashMissingCount`
- `durationMs`
- `leagueId`, `season`, `week`

Current shadow telemetry now carries these fields for started/completed/blocked/failed events.

### 11.5 Production gate criteria before Phase 7K read-path trials

Do not move to read-path canary until:

- Staging migration + rollback path is executed and documented.
- Canary gate passes for required sample set (or exceptions are documented and approved).
- No unresolved write-failure class errors in canary runs.
- Drift outcomes are within threshold or have approved rounding exception notes.
- UI parity checks report no regression on current score surfaces.

---

## 12) Phase 7K — Staging Canary Execution + Internal Read-Path Canary Plan

**Status:** Guardrails and execution scaffolding updated; staging writes remain blocked until environment confirmation is explicit.  
**Still not allowed in Phase 7K:** production migration apply, user-facing score cutover, scheduled writes, `PlayerWeeklyScore` removal, guardrail relaxation.

### 12.1 Staging environment confirmation result (current workspace)

Checks executed:

- `DATABASE_URL` target resolved to Neon host + `neondb`.
- `NODE_ENV` / `VERCEL_ENV` / `APP_ENV` were not explicit staging labels in shell checks.
- Prisma migration status was reachable and listed pending migration(s), but that does not by itself prove staging.
- Backup/checkpoint artifact could not be validated from repo automation alone.

Current classification:

- **Staging NOT positively confirmed for writes** (`no_positive_staging_signal`).
- Shadow-write canary is therefore **hard-blocked** by script guard even with `--confirmStaging`.

### 12.2 Migration execution checklist (exact commands, staging only)

Run only after explicit staging confirmation + approval:

1. **Checkpoint / backup**
   - Capture DB snapshot/backup ticket reference.
   - Record pre-migration row count baseline and migration status.
2. **Apply migration SQL**
   - `prisma db execute --file docs/sql/league-player-weekly-score-migration-draft.sql --schema prisma/schema.prisma`
3. **Generate Prisma client if needed**
   - `npx prisma generate --schema prisma/schema.prisma --no-engine`
4. **Verify table/constraints/indexes**
   - Table exists: `"league_player_weekly_scores"`
   - Unique: `(leagueId, playerId, week, season, sport)`
   - Indexes:
     - `(leagueId, season, week)`
     - `(playerId, season, week, sport)`
     - `(leagueId, updatedAt)`
5. **Record migration outcome**
   - Save command logs + schema verification output for canary packet.

### 12.3 Canary execution record (Phase 7K run in this workspace)

Executed commands:

- Dry run sample (read-only):
  - `npm run rollup:league-score-canary -- --leagueId phase7k-dryrun-sample --season 2026 --week 1 --dryRun`
- Shadow write sample (guard test):
  - `npm run rollup:league-score-canary -- --leagueId phase7k-write-sample --season 2026 --week 1 --shadowWrite --confirmStaging`

Observed outcomes:

- Dry run completed and emitted JSON summary.
- Remote DB read path had connection/lookup limitations for sample league (`league_not_found` in rollup/drift notes).
- Shadow-write attempt exited `2` and was blocked by staging guard (`staging_environment_not_confirmed`).

Execution packet fields captured from output:

- `candidateCount`
- `writeRequested` / `writeApplied`
- drift summary (`severity`, mismatch counts, missing stats counts)
- parity summary (`pass`, thresholds, failures)
- notes and guard block reason when applicable

### 12.4 Parity gate interpretation rules (Phase 7K)

Classify each canary result as:

- **pass**
- **pass_with_documented_exception**
- **fail**

Hard-fail conditions:

- team drift > `0.02`
- undocumented missing `PlayerGameStat` beyond expected allowance
- shadow write requested but not applied due runtime write failure
- unexpected global fallback count > 0
- duplicate key anomalies above documented allowance
- missing `scoringRulesHash` count not documented

### 12.5 First internal read-path canary plan (feature-flagged)

Flag contract:

- `LEAGUE_SCOPED_WEEKLY_SCORE_READS=off|internal|canary|on`

Phase 7K planning helper added:

- `lib/scoring/league-scoped-weekly-score-read-flag.ts`
  - parse mode
  - resolve scoped-read eligibility for internal/canary contexts
  - does not switch user-facing reads by itself

Recommended first internal consumer (no user-facing cutover):

- Internal diagnostic/admin comparison surface that returns:
  1. league-scoped row result (when flag allows),
  2. global fallback result,
  3. compute fallback result (diagnostic-only, explicit).

Read precedence contract for canary path:

1. `LeaguePlayerWeeklyScore` when feature flag path allows.
2. `PlayerWeeklyScore` only where global fallback is allowed.
3. compute-from-`PlayerGameStat` only when explicitly requested for diagnostics.

### 12.6 Rollback plan (staging canary scope)

If canary fails or drift regresses:

1. Disable shadow writes by removing `--shadowWrite` (or failing staging guard by env policy).
2. Set `LEAGUE_SCOPED_WEEKLY_SCORE_READS=off`.
3. If needed in staging: `DROP TABLE IF EXISTS "league_player_weekly_scores";` after checkpoint validation.
4. Rollback owner: scoring on-call / migration owner for that canary window.
5. Rollback SLA target: acknowledge within 15 minutes, execute disable within 30 minutes.

### 12.7 Go / no-go for Phase 7L

Proceed only when all are true:

- staging environment confirmation is explicit and recorded,
- migration applied + verified in staging only,
- canary set has required sample coverage or documented approved substitutions,
- parity gates pass (or approved documented exceptions),
- rollback runbook validated end-to-end in staging.

