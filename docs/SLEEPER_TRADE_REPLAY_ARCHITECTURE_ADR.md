# ADR — Sleeper Trade Replay Architecture

**Status:** Proposed, implemented (Phase 3), and **deployed + validated on staging with real data (Phase 4)** — the migration is live on staging (never production), and 38 real Sleeper trades across 3 leagues have been ingested and backtested, with isolation from live calibration confirmed against real data, not just mocks.
**Branch:** `g15-event-foundation`
**Follows:** `docs/SLEEPER_TRADE_INGESTION_AUDIT.md` (the real-data audit this ADR turns into a design), `docs/TRADE_LEARNING_CAPTURE_ARCHITECTURE_ADR.md` (the precedent this document's format and governance approach deliberately mirrors), `docs/TRADE_LEARNING_SHADOW_ROLLOUT.md`, `docs/DECISION_OS_RECOMMENDATION_CONSOLIDATION_PLAN.md`.
**Constraint honored (original ADR turn):** this document proposed no migration, no import job, no calibration-math change — a human reviewed the design questions before any implementation phase touched real Sleeper data or the database.

> **Implementation update (Phase 3):** per explicit direction, the schema and infrastructure below were generalized from "Sleeper trade replay" into a **generic, provider-agnostic, decision-type-agnostic Replay Framework** (`lib/replay-framework/`) with trades as the first implementation — not a Sleeper-specific or trade-specific subsystem. `provider` and `decisionType` are plain string columns, not enums, so a future replay type (waiver, draft, lineup, commissioner_action, roster_move) needs a new normalizer/backtest-executor pair, never a schema migration. See §9 for the full implementation record.

---

## 1. Replay purpose

The audit's central finding (`docs/SLEEPER_TRADE_INGESTION_AUDIT.md` §5) is the load-bearing constraint on everything below: a Sleeper-imported historical trade has no "our model predicted X, then the manager decided Y" moment — the manager never saw AllFantasy's model. This rules out one of the four candidate purposes outright and ranks the rest:

| Candidate purpose | Verdict | Why |
|---|---|---|
| **Model backtesting** | **Primary purpose** | Run the existing, unmodified deterministic trade-engine against real historical trades, using each league's real scoring context, and compare the model's *retroactive* prediction against the real, known outcome. This is the one purpose the data is actually suited for. |
| **Future offline evaluation** | **Primary purpose, same mechanism as backtesting** | A fixed, versioned corpus of real trades that any *future* model version can be re-run against, to answer "did the new model get better or worse at scoring real market behavior?" — this is backtesting applied repeatedly over time, not a separate mechanism (see §2's `modelVersion` design). |
| Diagnostics only | **Already served** | `docs/SLEEPER_TRADE_INGESTION_AUDIT.md` itself is this — confirming API shape and data completeness. This ADR's schema goes further than diagnostics-only would require, which is intentional (see below). |
| Recommendation validation | **A specific downstream consumer of backtesting, not a separate purpose** | Once `docs/DECISION_OS_RECOMMENDATION_CONSOLIDATION_PLAN.md`'s proposed trade-related Decision OS slices exist, they could be validated against this same replay corpus the same way the deterministic engine is — this ADR's design doesn't need a separate mechanism for it, only the same backtest-and-compare shape applied to a different model. |

**Explicitly not a purpose:** feeding Decision OS's manager-DNA/behavioral-facts pipeline as if it were genuine in-app behavioral signal (per the audit §5 and this task's own exclusion — Sleeper managers' decisions were never influenced by anything AllFantasy computed, so this data documents *Sleeper market behavior*, not *response to our recommendations*).

---

## 2. Schema design

**Two tables, not one** — a deliberate split, not the single flat table the audit's own "next implementation prompt" sketched. Reasoning: the *raw imported fact* of a real Sleeper trade (what happened, who was involved, what assets moved) is immutable and fetched once. The *backtested prediction* is not — it depends on which version of the deterministic trade-engine produced it, and the entire "future offline evaluation" purpose in §1 requires being able to re-run backtests against the same fixed raw corpus as the model changes over time, without re-fetching from Sleeper or duplicating the raw facts per model version.

### 2.1 `SleeperTradeReplay` — the raw imported fact, one row per real Sleeper trade

| Field | Type | Purpose |
|---|---|---|
| `id` | `String @id @default(uuid())` | Internal primary key |
| `sleeperLeagueId` | `String` | Sleeper's `league_id` — required per task |
| `sleeperTransactionId` | `String` | Sleeper's `transaction_id` — required per task |
| `season` | `Int` | Sleeper season year (e.g. `2025`) |
| `sleeperWeek` | `Int` | The round/week bucket the transaction was fetched under. **Documented caveat, carried forward from the audit (§3):** for offseason dynasty-league trades this is Sleeper's own bucket, not necessarily the real calendar week the trade occurred — do not treat this as a literal week number without checking `proposedAt`. |
| `proposedAt` | `DateTime` | From Sleeper's real `created` epoch-ms field |
| `resolvedAt` | `DateTime?` | From Sleeper's real `status_updated` epoch-ms field; null if still pending at ingestion time |
| `sleeperStatus` | `String` | Raw Sleeper status at ingestion time (`complete` \| `pending` \| `failed`) — stored verbatim, never coerced into our own `TradeOutcome` enum (see §4) |
| `rosterIdsInvolved` | `Json` (`number[]`) | Sleeper's own `roster_ids` array on the transaction |
| `managerUserIds` | `Json` (`{ rosterId: number; sleeperUserId: string }[]`) | Resolved via the `/rosters` → `/users` join confirmed working in the audit |
| `managerDisplayNames` | `Json` (`{ rosterId: number; displayName: string }[]`) | Denormalized for human readability/debugging only — never treated as an identity source of truth |
| `assetsGiven` / `assetsReceived` | `Json` | Normalized, per-manager-pair asset breakdown (name/type/value), intentionally shaped like `TradeOfferEvent.assetsGiven/assetsReceived` for eventual comparability — **but this is a structurally separate table, never the same table** (see §4) |
| `rawTransactionPayload` | `Json` | The full, unmodified Sleeper transaction object (`adds`/`drops`/`draft_picks`/`consenter_ids`/etc.) — kept verbatim so re-processing (e.g., a schema-mapping bug fix) never requires re-fetching from Sleeper |
| `leagueScoringSnapshot` | `Json` | The league's `scoring_settings`/`roster_positions`/`settings` **at ingestion time** — a snapshot, not a live reference, since a league's settings can change season to season and reproducibility requires freezing what was true when this trade happened |
| `isDynasty` / `isSuperFlex` | `Boolean` | Derived once from `leagueScoringSnapshot` at ingestion, cached for query convenience (mirrors the existing `resolveLeagueScoringContext()` convention in `lib/league-trade-engine/tradeLearningCapture.ts`) |
| `ingestSourceSleeperUserId` | `String` | Which connected Sleeper account's league list this row was discovered through — several accounts could share a league, this records provenance without implying exclusivity |
| `ingestedAt` | `DateTime @default(now())` | When this row was written, distinct from `proposedAt`/`resolvedAt` (Sleeper's real timestamps) |

**Idempotency key:** `@@unique([sleeperLeagueId, sleeperTransactionId])`. A real Sleeper trade is uniquely identified by its own league+transaction ID pair; re-running ingestion against the same league/week must not create duplicate raw-fact rows.

### 2.2 `SleeperTradeBacktestResult` — one row per (raw trade × model version)

| Field | Type | Purpose |
|---|---|---|
| `id` | `String @id @default(uuid())` | Internal primary key |
| `replayId` | `String` | FK to `SleeperTradeReplay.id` |
| `modelVersion` | `String` | Identifies which version of the deterministic trade-engine produced this backtest — required per task. Proposed value: the git commit SHA of `lib/trade-engine/` at backtest time (mirroring how `docs/TRADE_LEARNING_PRE_ENABLEMENT_AUDIT.md`'s own migration record already cites commit SHAs as its versioning convention), not a hand-maintained semantic version string |
| `backtestedAcceptProb` | `Float` | The reconstructed acceptance probability — output of the existing, unmodified `calibrateAcceptProbability()`, called with the frozen `leagueScoringSnapshot`'s scoring context |
| `backtestedVerdict` | `String` | The deterministic verdict (`computeTradeDrivers()`'s `verdict` field) the model would have given |
| `backtestedDriverSet` | `Json` | The full `TradeDriverData` output — lineup impact, VORP, market, behavior scores, driver evidence — kept for detailed inspection, not just the headline probability |
| `realOutcome` | `String` | Normalized, comparable outcome label — **only populated as a settled value when `SleeperTradeReplay.sleeperStatus === 'complete'`**; null/unset otherwise (see §4) |
| `replayComputedAt` | `DateTime @default(now())` | When *this specific backtest run* was computed — distinct from `ingestedAt` on the raw-fact row, since the same raw trade can be backtested many times across model versions |

**Idempotency key:** `@@unique([replayId, modelVersion])`. This is the design's central decision: **a new model version gets a new backtest row, it never overwrites the previous one.** This is what makes "future offline evaluation" (§1) real — a fixed replay corpus that accumulates one comparable result row per model version, so a query like "did model v2 score real trades more accurately than v1" is a straightforward join, not a destroyed-history problem.

---

## 3. Ingestion flow

1. **Pull user leagues** — `GET /user/{sleeperUserId}/leagues/nfl/{season}`, for the connected Sleeper account(s), per league discovery already proven in the audit.
2. **Pull transactions by week** — `GET /league/{leagueId}/transactions/{round}` for rounds 1–18 (or fewer, per the audit's finding that offseason dynasty trades cluster in the earliest rounds — but the ingestion job should still check the full range rather than assume this holds for every league format).
3. **Filter to trades** — `type === 'trade'` only; discard `waiver`/`free_agent` transaction types, which this ADR's scope does not cover.
4. **Normalize assets and managers** — resolve player IDs against a **locally cached** copy of `/players/nfl` (refreshed on a schedule, never re-fetched per trade — the audit confirmed this is a ~14.6MB static blob); draft picks require no extra lookup (Sleeper embeds `round`/`season`/`owner_id`/`previous_owner_id` directly); resolve `roster_ids` → Sleeper `user_id` → `display_name` via the `/rosters` + `/users` join the audit verified end-to-end.
5. **Snapshot league scoring/settings** — `GET /league/{leagueId}` once per league per ingestion run, stored into `leagueScoringSnapshot`.
6. **Write the raw fact** — upsert into `SleeperTradeReplay`, keyed by `(sleeperLeagueId, sleeperTransactionId)`.
7. **Run the backtest** — call the existing, unmodified `computeTradeDrivers()` + `calibrateAcceptProbability()` (`lib/trade-engine/trade-engine.ts` / `accept-calibration.ts`) using the frozen `leagueScoringSnapshot`'s scoring context, tag the result with the current `modelVersion`, and upsert into `SleeperTradeBacktestResult` keyed by `(replayId, modelVersion)`.

Steps 1–6 and step 7 are separable — the backtest step can be re-run independently and repeatedly (a new model version, a bug fix, a different scoring assumption) without re-touching Sleeper's API or steps 1–6's output at all. This separability is the direct payoff of the two-table split in §2.

---

## 4. Exclusions

- **No pending-trade assumptions unless observed.** Per the audit (§3), a trade's `sleeperStatus` is stored exactly as Sleeper reports it at ingestion time. If a trade is `pending` when ingested, `SleeperTradeReplay.resolvedAt` and `SleeperTradeBacktestResult.realOutcome` are left unset — the ingestion flow does not assume it will later resolve to any particular status, and does not retroactively backfill without a real re-check against Sleeper.
- **No production writes.** Every table, every write in this design targets staging only, exactly as every other real-database phase in this workstream has required explicit, same-turn approval before any write occurs. This ADR itself makes zero writes anywhere.
- **No live calibration table writes.** `SleeperTradeReplay`/`SleeperTradeBacktestResult` are structurally incapable of being picked up by `computeShadowB0()`'s `WHERE offerEventId IS NOT NULL` query — they are not `TradeOfferEvent`/`TradeOutcomeEvent` rows, have no `offerEventId` column, and no code path in this design ever writes to those two tables. `calibratedB0`/`shadowB0`/`TradeLearningStats` are untouched by this entire design.
- **No treating replay as native manager decision data.** `realOutcome` on a `SleeperTradeBacktestResult` row describes *what actually happened in a real Sleeper league*, evaluated retroactively against our model — it is never written into any Decision OS behavioral-facts table, `ManagerBehavioralFacts`, or Manager DNA input, because the manager who made that real decision never saw AllFantasy's model at the time they made it (the exact distinction the audit's §5 already established).

---

## 5. Validation metrics

Once real backtest rows exist (a future, separately-approved phase), the following metrics become computable — none require any new data beyond what §2's schema already captures:

| Metric | Computation | What it tells you |
|---|---|---|
| **Predicted acceptance vs. actual completed trades** | For every `SleeperTradeBacktestResult` where `realOutcome` is settled (i.e., the underlying trade's `sleeperStatus === 'complete'`), compare `backtestedAcceptProb` against the fact that the trade *did* complete — this is the backtested analogue of `computeObservedAcceptRate()`, applied to imported data instead of live-captured data | Whether the model's acceptance probabilities skew realistic against real market behavior it never trained on |
| **Fairness distribution** | Distribution of `backtestedDriverSet`'s value-differential/fairness component across the real trade corpus | Whether real accepted Sleeper trades cluster near what the model calls "fair," or whether the model sees a meaningfully different distribution than real markets produce |
| **Value-delta distribution** | Distribution of `assetsGiven`/`assetsReceived` value differential (from `leagueScoringSnapshot`-contextualized valuations) across real trades | A market-calibration sanity check independent of the model's own acceptance-probability output |
| **Manager/team archetype context, if available** | Where a Sleeper-connected manager is *also* a real AllFantasy user with existing Manager DNA/archetype data, segment backtest accuracy by that archetype | Whether backtest accuracy varies systematically by manager type — **conditional on real overlap existing**, which the audit did not measure and this ADR does not assume |
| **League settings sensitivity** | Segment backtest accuracy by `isSuperFlex`/`isDynasty`/scoring format (from `leagueScoringSnapshot`) | Whether the model's segment-aware calibration design (`computeSegmentB0s()`'s SF/1QB/TEP segments) generalizes to real external leagues, not just AllFantasy's own live-captured population |

All five metrics are read-only aggregate queries over `SleeperTradeReplay`/`SleeperTradeBacktestResult` — none require touching `TradeLearningStats` or any live calibration table, consistent with §4's separation.

---

## 6. Explicit separation from live calibration

This is the single most important property of the design, stated plainly:

- **Different tables.** `SleeperTradeReplay`/`SleeperTradeBacktestResult` are net-new, structurally separate from `TradeOfferEvent`/`TradeOutcomeEvent`. No foreign key, no shared unique constraint, no shared `mode` enum value connects them.
- **Different write path.** Nothing in this design calls `logTradeOfferEvent()`/`logTradeOutcomeEvent()` (the only writers of the live tables) or `captureLiveTradeOffer()`/`captureLiveTradeOutcome()` (the live-capture ADR's wiring). A future implementation of this ADR would add its own, entirely separate ingestion service.
- **Different read path.** `computeShadowB0()`, `promoteShadowB0()`, `computeSegmentB0s()`, and `runWeeklyRecalibration()` (`lib/trade-engine/auto-recalibration.ts`) query only `TradeOutcomeEvent`/`TradeOfferEvent`/`TradeLearningStats` — none of this design's tables are, or ever should be, referenced by those functions.
- **Different provenance semantics.** `TradeOfferMode.LIVE_PROPOSAL` (added in the live-capture ADR) means "a real AllFantasy user proposed this inside our own app, and our own model scored it in real time." This design's rows mean "a real Sleeper user proposed this on Sleeper's own platform, years or months ago, and our model scored it retroactively, after the fact." These are not interchangeable claims, and nothing in this design blurs that line — `SleeperTradeBacktestResult` never carries a `LIVE_PROPOSAL` mode value or any equivalent.
- **Different learning consequence.** A live-captured trade's outcome can, once `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` is on, move `calibratedB0`. Nothing produced by this design can ever move `calibratedB0` — there is no code path from `SleeperTradeBacktestResult` to `TradeLearningStats.calibratedB0`, by construction, not by a runtime guard that could later be removed.

---

## 7. Non-goals (unchanged, this phase and the next)

- No migration is created in this document. No Prisma schema file is touched.
- No Sleeper data is imported. No API call beyond what the audit already made (and did not repeat) occurs in this phase.
- No calibration math, threshold, or weight changes.
- `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` remains unset everywhere.
- No change to `lib/league-trade-engine/tradeService.ts`'s live capture wiring.
- No Chimmy wiring, no AI Coach migration — both explicitly out of scope per this task.

## 8. Rollout / risk (for a future implementation phase)

- Purely additive schema (two new tables, zero existing table/column altered) — same risk profile as the live-capture ADR's own schema change.
- The two-table split (§2) means the highest-blast-radius part of a future implementation (repeatedly re-running backtests as the model evolves) never needs to touch Sleeper's API again after initial ingestion — lowering the risk of hitting Sleeper's rate limits on every re-evaluation.
- Real, external, third-party data (other real Sleeper users' trades, not just the connected account's own) is being read — worth a light privacy note for a future phase: only publicly-exposed Sleeper league data (visible to any co-owner in a shared league, which is how Sleeper's own API already works) is read; nothing beyond what Sleeper itself already exposes to any league member is touched.
- A future implementation phase should follow this workstream's established discipline exactly: hand-authored migration, `prisma validate`/`generate` offline only, explicit same-turn approval before any staging deployment or real Sleeper API pull beyond what this audit already sampled.

---

## 9. Implementation record (Replay Framework Phase 3)

### 9.1 Generalization decision

Per explicit direction, before implementing, the design in §2 was generalized from `SleeperTradeReplay`/`SleeperTradeBacktestResult` (trade- and Sleeper-specific table names) into **`ReplayImport`/`ReplayBacktestResult`** — provider and decision-type are plain `String` columns (`provider`, `decisionType`), not enums or table-name suffixes. This is the only change from the design in §2/§3: field names, the two-table split, the versioning scheme, and every isolation guarantee are otherwise implemented exactly as designed. Trades remain the only *implemented* decision type — `decisionType: 'trade'` is one value the column happens to hold today, not a hardcoded assumption anywhere in the schema.

### 9.2 Implemented schema

Additive migration `prisma/migrations/20260706000000_add_replay_framework/migration.sql` — two brand-new tables (`replay_imports`, `replay_backtest_results`), zero existing table/column/enum touched. `npx prisma validate` passed; `npx prisma generate` regenerated the TypeScript client successfully (the native query-engine binary rename failed on a file lock held by another session's dev server running against this same directory — a known, unrelated Windows/multi-session artifact, not a schema problem; the generated `.d.ts` types used by `tsc` were written successfully before that point). **Not deployed to staging or any environment** — per this phase's scope, only local `prisma validate`/`generate` were run.

### 9.3 Implemented infrastructure

All under `lib/replay-framework/`, all manually invokable, none wired to any route/cron/scheduler:

| File | Role |
|---|---|
| `types.ts` | Generic `ReplayImportInput`/`BacktestResultInput`/`ReplayDecisionType` contracts, plus the trade-specific `TradeReplayPayload`/`TradeBacktestOutput`/`TradeRealOutcome` shapes stored in the generic `Json` fields |
| `writer.ts` | The *only* writer of `ReplayImport`/`ReplayBacktestResult` — idempotent upserts keyed by each table's natural unique constraint |
| `versioning.ts` | `resolveEngineVersionHash()` (reuses the exact env-var precedence already established by `app/api/af-debug/sha/route.ts`, not a new convention), `computeDeterministicConfigVersion()` (derived from the season's live `calibratedB0`), `TRADE_MODEL_VERSION` constant |
| `normalize/sleeperTradeNormalizer.ts` | Converts a real `SleeperTransaction` (from the pre-existing `lib/sleeper-client.ts`) into a generic `ReplayImportInput` — give/receive asset split, roster→owner→display-name identity resolution, dynasty/SuperFlex derivation, Sleeper-status normalization |
| `backtest/tradeBacktestExecutor.ts` | Calls the **real, unmodified** `computeTradeDrivers()` (`lib/trade-engine/trade-engine.ts`) and `calibrateAcceptProbability()` (`lib/trade-engine/accept-calibration.ts`) — the exact same deterministic pipeline every live trade-evaluation route already uses — against a normalized replay row |
| `ingest/ingestSleeperTradesForLeague.ts` | The manually-invokable orchestrator: reader → normalize → write replay → backtest → write backtest result, per league, with per-transaction error isolation (one bad trade does not abort the batch) |

**Reused rather than duplicated:** `lib/sleeper-client.ts` already had every Sleeper reader needed (`getLeagueInfo`, `getLeagueRosters`, `getLeagueUsers`, `getAllPlayers` — a cached 24-hour player directory, matching the audit's own caching recommendation — and `getAllLeagueTrades`, which *already* loops weeks and filters to `type: 'trade'`, exactly the ingestion-flow step §3 called for). No new Sleeper API client code was written; `lib/replay-framework/` calls this existing module directly.

### 9.4 Isolation verified, not just asserted

Two complementary proofs, both passing: `__tests__/replay-framework/writer.test.ts` behaviorally confirms (mocked Prisma) that `upsertReplayImport()`/`upsertBacktestResult()` never call `tradeOfferEvent`/`tradeOutcomeEvent`/`tradeLearningStats`; `__tests__/replay-framework/isolation.test.ts` statically scans every file under `lib/replay-framework/` for forbidden imports (`trade-event-logger`, `tradeLearningCapture`, `auto-recalibration`, `tradeService`) and forbidden `prisma.*` model access, and additionally asserts the writer module's only two `prisma.*` call sites are `prisma.replayImport`/`prisma.replayBacktestResult`.

### 9.5 Tests added

30 new tests across 6 files (`writer.test.ts`, `sleeperTradeNormalizer.test.ts`, `tradeBacktestExecutor.test.ts`, `versioning.test.ts`, `isolation.test.ts`, `ingestSleeperTradesForLeague.test.ts`), covering: real insertion, idempotent duplicate-import prevention (same natural key twice), normalization correctness (give/receive split, identity join, dynasty/SF derivation, both real timestamps, pending trades correctly left unresolved), deterministic backtest execution against the real trade-engine functions (mocked only to control output), version-key distinctness across engine/config changes, structural + behavioral isolation from live calibration, and per-transaction error isolation in the orchestrator (one bad trade doesn't abort the batch).

### 9.6 Verification results

`npx vitest run __tests__/replay-framework/` — 30/30 passed. `npx vitest run __tests__/trade-engine/` plus the 5 Decision OS architecture test files — 102/102 passed, zero regressions. `npx tsc --noEmit` — see the verification section of this phase's delivered summary for the exact comparison against the prior baseline.

### 9.7 Remaining work before the first real Sleeper replay import

- ~~Deploy the migration to staging~~ — **done, Phase 4** (§10 below).
- ~~Actually invoke `ingestSleeperTradesForLeague()` against a real league~~ — **done, Phase 4**.
- ~~Decide which leagues/accounts to ingest first~~ — **done, Phase 4**: 3 leagues from the Phase 1 audit's already-sampled set.
- **Build the validation-metrics queries from §5** — still not done; the schema supports them (read-only aggregates over `ReplayImport`/`ReplayBacktestResult`), and Phase 4's real backtest data is now available to query, but no query/report code exists yet.
- **Future replay types** (waiver, draft, lineup, commissioner_action, roster_move) — still explicitly out of scope; each needs its own normalizer + backtest executor, reusing the same `ReplayImport`/`ReplayBacktestResult` tables with a new `decisionType` value and zero schema changes.
- **Import the remaining 28 already-audited leagues (or the other 82 leagues never sampled)** — Phase 4 deliberately ingested only 3 leagues as a small controlled first run; broader ingestion is a natural next step, not yet done.

---

## 10. Staging deployment and first real ingestion (Replay Framework Phase 4)

### 10.1 Migration deployed

`prisma/migrations/20260706000000_add_replay_framework/migration.sql` was applied to staging one statement at a time via the Neon SQL tool (both `CREATE TABLE`s, all 5 indexes, the FK constraint), then recorded in `_prisma_migrations` (checksum computed locally via `sha256sum`, matching this workstream's established convention). Verified after deployment: `information_schema.tables` confirms both `replay_imports`/`replay_backtest_results` exist; `pg_indexes` confirms both unique constraints and all 3 non-unique indexes exist exactly as the migration defines them; `pg_constraint` confirms the `replay_backtest_results → replay_imports` foreign key exists. **Not touched:** the `production` branch, at any point.

### 10.2 First real ingestion — 3 leagues, 38 real trades, zero failures

Ran `ingestSleeperTradesForLeague()` for real against 3 leagues selected from the Phase 1 audit's already-sampled set (not new leagues — reusing already-verified data shape): `Going Deep League` (2025, complete season, 21 real trades), `Nfl Dreaming 2!` (2025, complete season, 14 real trades), `Dynasty for life!` (2026, in-season/offseason dynasty trading, 3 real trades).

| Metric | Result |
|---|---|
| Leagues ingested | 3 |
| Real trade transactions found | 38 |
| `ReplayImport` rows written | 38 |
| `ReplayBacktestResult` rows written | 38 |
| Failures | 0 |
| Model version used | `trade-engine-deterministic-v1` (`engineVersionHash: "dev"` — no `BUILD_SHA`/`VERCEL_GIT_COMMIT_SHA` set in this local-script run, correctly falling back per `resolveEngineVersionHash()`'s design) |
| Season coverage | 35 trades at `season: 2025`, 3 at `season: 2026` — matches the 2 ingested 2025 leagues + 1 ingested 2026 league exactly |
| `providerStatus` coverage | All 38 `complete` — no pending trades encountered in this real ingestion, consistent with the Phase 1 audit's own finding that pending status is transient and rarely caught in any single pass |

**Idempotency proved against real data, not just mocks:** the first league (`Going Deep League`) was deliberately re-ingested a second time in the same run. `replayCount`/`backtestCount`, measured *after* the re-ingestion, were still exactly 38/38 — not 59/59 — confirming the real unique constraints correctly upserted the same 21 rows in place rather than creating duplicates.

**Sample real backtest output** (one of the 38 rows): a real historical trade the deterministic engine scored `verdict: "Major Overpay"`, `acceptProb: 0.22` against a real outcome of `ACCEPTED` — an honest, unmassaged data point for the future validation-metrics work in §5, not something this phase interprets further (that analysis is explicitly what the still-outstanding §5 metrics queries are for).

### 10.3 Isolation confirmed against real data

Measured directly, immediately after the real ingestion run: `TradeOfferEvent` count `0`, `TradeOutcomeEvent` count `0`, `TradeLearningStats` count `0` — the real ingestion run wrote to `replay_imports`/`replay_backtest_results` only, exactly as designed and as the mocked isolation tests already predicted. This is the first time that isolation guarantee was verified against a real database and real Sleeper data, not just mocked unit tests.

### 10.4 No cleanup performed — this data is the deliverable, not a disposable fixture

Unlike Trade Learning's live-capture validation runs (Phase 9, Phase 11), which used clearly-synthetic, isolated test leagues explicitly deleted afterward to keep the *real calibration pool* uncontaminated for a later organic-volume measurement, this replay data is real, genuinely useful, and structurally incapable of contaminating anything — it lives in its own tables, has no bearing on `computeShadowB0()`/`calibratedB0`, and is intentionally meant to accumulate into an ongoing validation corpus over time. It was left in staging.

### 10.5 Validation metrics (Phase 5)

A read-only metrics module (`lib/replay-framework/metrics/tradeReplayMetrics.ts`) was built and run against this real data — full analysis in `docs/SLEEPER_TRADE_REPLAY_VALIDATION_REPORT.md`. Headline finding: real accepted trades in this corpus cluster at a striking 20–30% predicted acceptance (avg 0.2566 across all 38), a genuine signal worth investigating further, but one confounded by three structural factors specific to this replay pipeline (survivorship bias — only `complete` trades are ever observed; no roster/lineup context during backtesting; present-day valuations applied to historical trades) rather than clear evidence of trade-engine miscalibration. See the report for the full breakdown and honest caveats.

### 10.6 Roster context enrichment (Phase 6)

`TradeReplayPayload` gained optional `proposerRoster`/`counterpartyRoster` fields (each side's full real roster, resolved from Sleeper's own `roster.players`, not just the traded assets); `tradeBacktestExecutor.ts` now builds and passes a real `rosterCtx` to `computeTradeDrivers()` instead of `undefined`. All 38 real rows were re-ingested in place (same natural keys — idempotent update, not new rows) with real roster sizes (e.g. 39/34 players resolved per side on one real trade).

**Result, precisely root-caused, not guessed:** confidence scores rose by exactly +10 across all 38 rows (the engine's flat data-completeness bonus for `hasLineupData` firing correctly), but `acceptProb`/verdict/`lineupImpactScore` were **byte-identical** before and after. Traced to `computeTradeDrivers()`'s own gate (`(hasLineupData || hasImpactData) && hasVorpData`, `trade-engine.ts` line 769): the richer scoring branch that would actually consume the real lineup delta also requires `Asset.vorpValue` to be populated, which neither this replay pipeline's traded-asset resolver nor its new roster resolver ever sets (only the FantasyCalc-derived `value` field). This is not a trade-engine bug and not a wiring bug in this phase — it precisely narrows the next real enrichment item (populate `vorpValue`, not just `value`) and **disconfirms** Phase 5's speculation that missing roster context was depressing acceptance probability specifically. Full before/after numbers and the confirming query in `docs/SLEEPER_TRADE_REPLAY_VALIDATION_REPORT.md` §8.

### 10.7 VORP enrichment (Phase 7)

Populated `Asset.vorpValue` — the exact gap Phase 6 identified — for every traded and roster-context asset, by reusing the same `computePlayerVorp()` primitive (`lib/vorp-engine.ts`) native trade flows already call, via a new `lib/replay-framework/valuation/vorpResolver.ts` (also derives a real `LeagueRosterConfig` from each league's actual `roster_positions`, not a generic default). All 38 real rows re-ingested in place.

**Result:** the richer scoring branch (line 769) now genuinely activates — confirmed directly: `lineupImpactScore` is no longer pinned at `0.1`, now showing real varying values; verdict distribution shifted meaningfully ("Major Overpay" disappeared, more "Slight Win"); confidence distribution widened dramatically (19 of 38 rows jumped to 80–90, up from a tight 40–60 band). **But average predicted acceptance stayed exactly the same (0.2565789473684211, byte-identical again)** — `verdict` and `acceptProb` are computed via genuinely separate paths in `computeTradeDrivers()` (`computeVerdict(totalScore100)` vs. the independent `computeSmartAcceptProbability()` call), and for this specific 38-trade sample the latter's population average landed unchanged despite real per-row movement. **This means VORP enrichment does not change the Phase 5 low-acceptance finding** — both roster-context and VORP hypotheses are now ruled out as explanations for that specific clustering, strengthening the two remaining candidates (survivorship bias, stale valuations). Full analysis in `docs/SLEEPER_TRADE_REPLAY_VALIDATION_REPORT.md` §9.

### 10.8 Acceptance probability audit (Phase 8) — the definitive root cause

Traced `computeSmartAcceptProbability()` with source-level certainty: its `vorpDeltaThem` parameter (and, newly discovered, also `behaviorScore` and `marketScore`) is passed in and **never read in the function body** — confirmed by direct inspection, each appears exactly once, in its own parameter declaration. VORP has no code path into `acceptProb` at all. Separately, a read-only diagnostic against 6 real staging replay rows found the lineup-delta channel (`deltaThem`/`needFitPPGThem`, gated only on `hasLineupData`) genuinely functional — but `deltaThem = 0` for 5 of 6 real trades sampled, because these are real dynasty bench-depth trades that don't change either side's actual best-possible starting lineup. Both facts proven with dedicated, unmocked tests against the real engine (`__tests__/trade-engine/accept-prob-vorp-lineup-separation.test.ts`). Reasoned assessment (not certain): more likely incomplete/vestigial wiring than deliberate design (three unused composite-score parameters is a pattern, not an isolated case; no documentation anywhere states an intentional fairness-vs-acceptance separation). No fix proposed or implemented — full analysis, complete input→output map, and the Phase 9 recommendation in `docs/TRADE_ENGINE_ACCEPT_PROBABILITY_ARCHITECTURE_NOTE.md` and `docs/SLEEPER_TRADE_REPLAY_VALIDATION_REPORT.md` §10.

### 10.9 Corpus expansion + two confirmed replay-pipeline bugs (Phase 9) — the "bench-depth" finding was itself substantially a pipeline artifact

Expanded the corpus from 3 to 8 real Sleeper leagues (38 → 238 trades), adding 5 real keeper/redraft-format leagues (found via `settings.type` reconnaissance) chosen specifically for likely lineup turnover. While building this comparison, found and fixed **two real bugs in the replay pipeline's own glue code** (never in `computeTradeDrivers()`, not modified): (1) `toAssets()`/`toRosterAssets()` assigned disjoint synthetic ID namespaces to the same real player, so `computeLineupDelta()`'s give/receive-vs-roster matching could never succeed — fixed by threading a real, stable `providerAssetId` through consistently; (2) `assetsGiven`/`assetsReceived` never carried `pos` at all, so every incoming traded player was invisible to `computeBestLineupPPG()`'s lineup calculation — fixed by threading `pos` through the same way. Both fixes verified end-to-end against the real, unmocked engine (`__tests__/replay-framework/tradeBacktestExecutor.idConsistency.test.ts`).

**This substantially revises Phase 8's §10.1 fact 2 characterization.** Once both bugs were fixed and all 238 rows re-ingested: the lineup-delta channel is confirmed genuinely responsive to real signal — starter-involved trades (38% of the real corpus) average **0.57** predicted acceptance vs. **0.25** for bench-depth trades (62%), a ~2.3x gap, consistent across both the original dynasty leagues and the new keeper/redraft leagues. The earlier "deltaThem = 0 for 5 of 6 trades, a genuine population property" conclusion was itself an artifact of Bug 2 (received players structurally invisible to the lineup calc), not a real finding about the trade population — though the underlying observation that *most* real trades are bench-depth (61-71%, even in leagues selected for turnover) does hold up post-fix. Full before/after tables, methodology, and the Phase 10 recommendation in `docs/SLEEPER_TRADE_REPLAY_VALIDATION_REPORT.md` §11.

---

## Files changed in this session

- `docs/SLEEPER_TRADE_REPLAY_ARCHITECTURE_ADR.md` (this document, updated with §9, then §10)
- `prisma/schema.prisma` (modified — additive: `ReplayImport`, `ReplayBacktestResult` models)
- `prisma/migrations/20260706000000_add_replay_framework/migration.sql` — **deployed to staging** (not production)
- `lib/replay-framework/types.ts`, `versioning.ts`, `writer.ts` (new)
- `lib/replay-framework/normalize/sleeperTradeNormalizer.ts` (new)
- `lib/replay-framework/backtest/tradeBacktestExecutor.ts` (new)
- `lib/replay-framework/ingest/ingestSleeperTradesForLeague.ts` (new)
- `__tests__/replay-framework/{writer,sleeperTradeNormalizer,tradeBacktestExecutor,versioning,isolation,ingestSleeperTradesForLeague}.test.ts` (new, 30 tests)

No calibration math, threshold, or weight was changed. No Sleeper data was imported. No database (staging or production) was written to or connected to. `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` remains unset everywhere. `lib/league-trade-engine/tradeService.ts` (live trade capture) was not modified. Chimmy and AI Coach were not touched.
