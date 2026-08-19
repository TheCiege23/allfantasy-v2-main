# Decision OS Replay Framework Phase 11 — Generalization ADR: From Trade Replay Utility to a Decision OS Validation Platform

**Status:** Architecture audit + ADR. One low-risk, zero-behavior-change refactor implemented (§7). No Trade Learning code touched. No `acceptProbability`/trade-engine code touched. No calibration enabled. Existing Sleeper trade replay implementation unchanged in behavior.
**Update (Phase 13):** the §8.1-deferred generalization of `computeDeterministicConfigVersion()` was implemented, informed by Lineup Replay as a real second consumer with no tunable config at all — exactly the trigger condition §8.1 specified. Trade's existing call site is byte-identical (a bare number still resolves to `b0:X.XXXX`); see `docs/DECISION_OS_LINEUP_REPLAY_VALIDATION_REPORT.md` §1.
**Branch:** `g15-event-foundation`
**Builds on:** `docs/SLEEPER_TRADE_REPLAY_ARCHITECTURE_ADR.md` (Phases 2–3's original two-table design — this ADR confirms that design already anticipated most of what follows), `docs/SLEEPER_TRADE_REPLAY_VALIDATION_REPORT.md`, `docs/DECISION_OS_VORP_ACCEPTANCE_ADR.md` (Phase 10).

---

## 1. Headline finding: the framework was already designed generically; only the trade implementation grew organically on top of it

Auditing `lib/replay-framework/` file by file, the honest conclusion is that Phase 3's original design (`ReplayImport`/`ReplayBacktestResult` as plain `provider`/`decisionType` string columns over `Json` payloads, explicitly "so future replay types need zero schema migration") was correct and has held up through 8 phases of real, load-bearing use. What has NOT yet happened is separating the parts that are genuinely trade-specific business logic from the parts that are accidentally trade-specific only because trade was the first (and so far only) implementation. This phase does that separation as a design exercise, with one small, obviously-safe extraction actually implemented (§7) and the rest documented as a roadmap (§8) rather than spoken for by guesswork.

---

## 2. Audit: current architecture, file by file

| File | What it does | Generic today? |
|---|---|---|
| `prisma/schema.prisma` (`ReplayImport`, `ReplayBacktestResult`) | Two tables, plain string `provider`/`decisionType` columns, `Json` payload/output columns | **Yes — fully generic, zero changes needed for any new decision type or provider** |
| `writer.ts` (`upsertReplayImport`, `upsertBacktestResult`) | Idempotent upsert by natural keys | **Yes — fully generic, operates purely on the generic `ReplayImportInput`/`BacktestResultInput` shapes** |
| `__tests__/replay-framework/isolation.test.ts` | Recursive source scan proving no file under `lib/replay-framework/` imports live Trade Learning code or tables | **Yes — fully generic, automatically covers any file added under this directory, no per-decision-type update ever needed** |
| `versioning.ts` → `resolveEngineVersionHash()` | Reads `BUILD_SHA`/etc. env vars | **Yes — fully generic** |
| `versioning.ts` → `TRADE_MODEL_VERSION` | A named constant string | Trade-specific by design (a label for trade's own scoring approach) — the *pattern* (one named constant per decision type) is generic |
| `versioning.ts` → `computeDeterministicConfigVersion(calibratedB0: number)` | Serializes trade's single tunable float (`calibratedB0`) into a version string | **Coupled to trade's specific config shape** — see §8.1 |
| `types.ts` → `ReplayDecisionType`, `ReplayImportInput`, `BacktestResultInput` | The shared, top-level contracts | **Yes — already generic; `ReplayDecisionType` already lists `trade\|waiver\|draft\|lineup\|commissioner_action\|roster_move` (declared in Phase 3, unused until a second type is built)** |
| `types.ts` → `TradeReplayRosterAsset`, `TradeReplayPayload`, `TradeBacktestOutput`, `TradeRealOutcome` | Trade's own `payload`/`backtestedOutput`/`realOutcome` shapes | Trade-specific by design — every decision type needs its own equivalent shapes |
| `normalize/sleeperTradeNormalizer.ts` | Sleeper-raw-transaction → `TradeReplayPayload` | Provider-specific (Sleeper) **and** decision-type-specific (trade) — the intersection of both axes |
| `valuation/vorpResolver.ts` | VORP resolution for trade assets, reusing `computePlayerVorp()` | Decision-type-specific (trade's own valuation concern; doesn't generalize to e.g. draft-pick value) |
| `backtest/tradeBacktestExecutor.ts` | Calls the real, unmodified `computeTradeDrivers()`/`calibrateAcceptProbability()` | Decision-type-specific, **provider-agnostic already** — operates only on the normalized `TradeReplayPayload`, never on Sleeper-raw data |
| `ingest/ingestSleeperTradesForLeague.ts` | Fetches Sleeper data, loops trades, calls normalizer → writer → executor → writer | Provider-specific **and** decision-type-specific (the intersection) — but its *shape* (fetch → normalize → write → execute → write, looped) is a fully generic pattern |
| `metrics/tradeReplayMetrics.ts` | Reads the generic Prisma rows, casts to trade types, computes trade-specific distributions | Decision-type-specific, provider-agnostic already; contained two genuinely generic helper functions (§7) |

**Conclusion:** the framework/decision-type boundary is real and mostly already correct by construction — the *files* look trade-specific mainly because they're named after trade and physically located without a decision-type subfolder, not because their logic is fundamentally unable to generalize. The *provider* axis (Sleeper today) is already cleanly isolated to exactly two files (`normalize/sleeperTradeNormalizer.ts`, `ingest/ingestSleeperTradesForLeague.ts`) — nothing else in the framework has ever referenced Sleeper by name.

---

## 3. The generic Replay Scenario abstraction

A **Replay Scenario** = one (provider × decisionType) combination. Concretely, it is the set of four things needed to replay and validate a real historical decision of that type from that provider:

```
ReplayScenario<TPayload, TOutput> = {
  normalizer:  (providerRawData, context) => ReplayImportInput  // payload: TPayload
  executor:    (ReplayImportInput) => BacktestResultInput        // backtestedOutput: TOutput
  metrics:     (providerLeagueIds?) => MetricsSummary            // decisionType-specific distributions
  ingestDriver: (scope) => IngestResult                          // orchestration: fetch -> normalize -> write -> execute -> write, looped
}
```

Today's Sleeper-trade implementation is exactly one instantiation of this shape (`TPayload = TradeReplayPayload`, `TOutput = TradeBacktestOutput`), built before the abstraction was named. **No code changes are required to make this abstraction real for trade** — it already conforms; this section documents the shape so a second scenario (e.g., Sleeper-waiver, or ESPN-trade) has a template to follow rather than re-deriving the pattern from scratch.

```mermaid
flowchart TB
    subgraph Framework-level (decision-type-agnostic, provider-agnostic)
        Writer["writer.ts<br/>upsertReplayImport / upsertBacktestResult"]
        Schema[("ReplayImport / ReplayBacktestResult<br/>(Json payload / Json backtestedOutput)")]
        Versioning["versioning.ts<br/>resolveEngineVersionHash()"]
        MetricsShared["metrics/shared.ts<br/>bucketize() / average() / bucketizeSignedMagnitude()"]
        Isolation["isolation.test.ts<br/>(recursive scan, auto-covers new files)"]
    end

    subgraph "Decision-type-specific (provider-agnostic)"
        TradeTypes["types.ts: TradeReplayPayload / TradeBacktestOutput"]
        TradeExec["backtest/tradeBacktestExecutor.ts<br/>calls REAL computeTradeDrivers()"]
        TradeMetrics["metrics/tradeReplayMetrics.ts"]
        TradeVal["valuation/vorpResolver.ts"]
    end

    subgraph "Provider adapters (provider-specific AND decision-type-specific)"
        SleeperTradeNorm["normalize/sleeperTradeNormalizer.ts"]
        SleeperTradeIngest["ingest/ingestSleeperTradesForLeague.ts"]
        FutureESPNTrade["(future) normalize/espnTradeNormalizer.ts"]
        FutureSleeperWaiver["(future) normalize/sleeperWaiverNormalizer.ts"]
    end

    SleeperTradeIngest --> SleeperTradeNorm
    SleeperTradeNorm --> TradeTypes
    SleeperTradeIngest --> Writer
    SleeperTradeIngest --> TradeExec
    TradeExec --> Versioning
    TradeExec --> Writer
    Writer --> Schema
    TradeMetrics --> Schema
    TradeMetrics --> MetricsShared
    FutureESPNTrade -.->|"same TradeReplayPayload shape"| TradeTypes
    FutureSleeperWaiver -.->|"new WaiverReplayPayload shape"| TradeTypes
```

---

## 4. Extension points

**To add a new provider for an existing decision type** (e.g., ESPN trades, alongside Sleeper trades): write one new normalizer (`normalize/espnTradeNormalizer.ts`) that maps ESPN's raw transaction shape into the *same* `TradeReplayPayload`/`ReplayImportInput` the Sleeper normalizer already produces, and one new ingest driver (`ingest/ingestEspnTradesForLeague.ts`) that fetches ESPN data and calls that normalizer. **Zero changes** to `tradeBacktestExecutor.ts`, `tradeReplayMetrics.ts`, `writer.ts`, `versioning.ts`, or the Prisma schema — the backtest executor and metrics module only ever see the normalized `TradeReplayPayload` shape, never provider-raw data. This is the concrete meaning of "provider-agnostic": the provider boundary is drawn at exactly one seam (the normalizer), not smeared across the pipeline.

**To add a new decision type for an existing provider** (e.g., Sleeper waivers, alongside Sleeper trades): add a `WaiverReplayPayload`/`WaiverBacktestOutput` pair to `types.ts` (or a co-located file), a `waiverBacktestExecutor.ts` that calls whatever real, unmodified waiver-scoring function exists (mirroring how `tradeBacktestExecutor.ts` calls `computeTradeDrivers()`), a `sleeperWaiverNormalizer.ts`, an `ingestSleeperWaiversForLeague.ts`, and a `waiverReplayMetrics.ts` (reusing `metrics/shared.ts`'s primitives). Add `'waiver'` as the `decisionType` value passed to `upsertReplayImport`/`upsertBacktestResult` — already a valid value in the `ReplayDecisionType` union (declared Phase 3, unused until now). **Zero schema migration.** The isolation test automatically covers the new files with no edit.

**To add a new provider for a new decision type simultaneously**: both of the above apply — write the (provider × decisionType) normalizer/ingest-driver pair, plus the decisionType's executor/metrics/types if they don't exist yet.

---

## 5. Provider adapters

Providers are adapters in the strict sense: each one's *only* job is translating that provider's raw API shape into the shared, provider-agnostic `{DecisionType}ReplayPayload` contract. This ADR's design supports the full requested provider roadmap without any structural change:

| Provider | Status | What a new adapter needs |
|---|---|---|
| Sleeper | **Live** (trade) — `lib/sleeper-client.ts` reused entirely, zero duplication | n/a |
| ESPN | Future | A new `lib/espn-client.ts`-equivalent (if one doesn't already exist) + one normalizer per decision type, following `sleeperTradeNormalizer.ts`'s exact pattern |
| Yahoo | Future | Same shape — Yahoo's OAuth-gated API is a client-layer concern, entirely outside the replay framework's boundary |
| Fantrax | Future | Same shape |
| MFL (MyFantasyLeague) | Future | Same shape |
| Any future provider | Future | Same shape — the framework places zero assumptions on how a provider authenticates, paginates, or names its fields; all of that is absorbed by the normalizer |

The key design property making this true: **`ReplayImportInput.rawProviderPayload` stores the provider's raw payload verbatim** (already a Phase 3 decision, unchanged) — so a provider's peculiarities are preserved for reprocessing without ever leaking into the shared `payload`/`backtestedOutput` contract that the rest of the framework depends on.

---

## 6. Replay executors

An executor's contract, generalized from `tradeBacktestExecutor.ts`'s concrete shape:

```
{decisionType}BacktestExecutor(input: {decisionType}BacktestInput) => BacktestResultInput
```

Its one hard invariant, upheld by trade's executor and required of any future one: **it must call the real, unmodified, production deterministic-scoring function for that decision type** — never a reimplementation, never a simplified proxy. This is what makes replay validation meaningful (it answers "what would the real production model have said," not "what does a similar-but-different model say"). `tradeBacktestExecutor.ts` calling the exported `computeTradeDrivers()` from `lib/trade-engine/trade-engine.ts` (never modified across 11 phases) is the concrete precedent — a future waiver executor would call whatever the real waiver-priority scoring function is (`lib/waiver-engine/...`, unmodified), a future draft executor would call the real draft-grading function, and so on. This invariant is a process/review discipline, not something enforceable by a type signature — it should be called out explicitly in any future phase's plan and verified during code review, the same way this workstream's `isolation.test.ts` enforces the *separate* Trade-Learning-isolation invariant structurally.

---

## 7. Metrics interfaces — implemented refactor (low-risk, zero behavior change)

**What was extracted:** `bucketize()`, `average()`, and `bucketizeDeltaThem()` (renamed `bucketizeSignedMagnitude()` — its logic was never actually trade-specific, only its old name and docstring were) were moved out of `tradeReplayMetrics.ts` into a new `lib/replay-framework/metrics/shared.ts`, byte-identical bodies, no behavior change. `tradeReplayMetrics.ts` now imports and uses them exactly as before.

**Why this qualifies as "obvious and low-risk" per this phase's explicit constraint:** these two functions were the *only* pieces of `tradeReplayMetrics.ts` that read no trade-specific type and computed nothing trade-semantic (no `verdict`, no `deltaThem`'s trade meaning, no fairness) — they are pure histogram/average primitives over plain `number[]`. Moving them required no design decision about a future decision type's shape (unlike, say, generalizing `computeDeterministicConfigVersion`'s signature — deferred, see §8.1, because doing that *would* require guessing at a shape with no second real consumer yet to validate against). All 9 pre-existing `tradeReplayMetrics.test.ts` tests pass unchanged; 7 new direct tests were added for the relocated module in `__tests__/replay-framework/metricsShared.test.ts` (it previously had zero direct coverage, only indirect coverage via trade fixtures).

**What stays decision-type-specific in `tradeReplayMetrics.ts`:** `computeValueDeltaPct()` (reads `TradeReplayPayload.assetsGiven`/`assetsReceived` directly — inherently trade-shaped), the fairness/verdict distribution, the `deltaThem`/starter-involved/bench-depth split, and the `TradeReplayMetricsSummary` interface itself. A future `{decisionType}ReplayMetrics.ts` would define its own summary interface and its own decision-semantic distributions, while importing `bucketize`/`average`/`bucketizeSignedMagnitude` from the same shared module rather than re-implementing them.

---

## 8. What stays trade-specific vs. what is framework-level — explicit summary

**Framework-level (reuse as-is, zero changes needed for a new decision type or provider):**
- `prisma/schema.prisma`'s `ReplayImport`/`ReplayBacktestResult` models
- `writer.ts` (`upsertReplayImport`, `upsertBacktestResult`)
- `versioning.ts`'s `resolveEngineVersionHash()`
- `metrics/shared.ts`'s `bucketize()`, `average()`, `bucketizeSignedMagnitude()` (new, this phase)
- `isolation.test.ts` (automatically covers new files)
- `types.ts`'s `ReplayDecisionType`, `ReplayImportInput`, `BacktestResultInput`

**Trade-specific (each future decision type builds its own equivalent):**
- `types.ts`'s `TradeReplayPayload`/`TradeBacktestOutput`/`TradeRealOutcome`/`TradeReplayRosterAsset`
- `backtest/tradeBacktestExecutor.ts` (calls the real `computeTradeDrivers()`)
- `metrics/tradeReplayMetrics.ts`'s decision-semantic distributions and `TradeReplayMetricsSummary`
- `valuation/vorpResolver.ts` (trade's own valuation concern — a future decision type would add its own domain-specific valuation helper only if it needs one)
- `versioning.ts`'s `TRADE_MODEL_VERSION` constant (pattern: one named constant per decision type)

**Provider-specific (each future provider builds its own adapter per decision type it supports):**
- `normalize/sleeperTradeNormalizer.ts`
- `ingest/ingestSleeperTradesForLeague.ts`

### 8.1 Deferred, not implemented: `computeDeterministicConfigVersion()`'s signature

Currently `computeDeterministicConfigVersion(calibratedB0: number): string` — coupled to trade's one tunable float. A decision-type-agnostic version would take a generic config descriptor (e.g. `Record<string, string | number>`) and serialize it deterministically. **Not implemented this phase** — with only one real consumer (trade) in existence, choosing that generic shape now would mean guessing at what a second decision type's tunable config actually looks like (a waiver engine might have zero tunables, a draft grader might have three) rather than generalizing from a real second example. Recommended to generalize this function at the point the *first* non-trade executor is actually built (Phase 12+), informed by that real shape, not before.

---

## 9. Backward compatibility with the existing trade replay implementation

**Fully preserved.** The only code change this phase made (§7's extraction) is a pure relocation with identical function bodies — verified by all 61 pre-existing replay-framework tests passing unchanged, plus 7 new direct tests for the relocated module. No Prisma schema change, no signature change to any exported function still in use by `tradeBacktestExecutor.ts`, `ingestSleeperTradesForLeague.ts`, or the 238-row real staging corpus built across Phases 4–9. Every real replay row already in staging remains valid and queryable exactly as before.

---

## 10. Migration roadmap (if/when a second Replay Scenario is built)

1. Decide the (provider × decisionType) pair for the second scenario — likely candidates per this phase's prompt: Sleeper-waiver (reuses `lib/sleeper-client.ts`'s existing waiver-adjacent readers, mirrors the trade precedent most closely) or Sleeper-draft.
2. Add the decisionType's `{DecisionType}ReplayPayload`/`{DecisionType}BacktestOutput` shapes to `types.ts`.
3. Identify the real, unmodified, production deterministic-scoring function to call (the executor's hard invariant, §6) — confirm it is exported and has no live side effects, the same audit step Phase 3 did for `computeTradeDrivers()`.
4. Write the normalizer, executor, ingest driver, and metrics module, following the four existing trade files as templates.
5. At this point, generalize `computeDeterministicConfigVersion()` (§8.1) informed by the real second config shape.
6. Add a `{decisionType}ReplayMetrics.test.ts` and extend `isolation.test.ts`'s expectations if the new decision type introduces its own forbidden-import list (unlikely — the existing list is decision-type-agnostic already).
7. No step in this list requires a schema migration.

---

## 11. Recommendation for Phase 12

**Do not build a second Replay Scenario speculatively.** This phase's audit shows the framework is already structurally ready (§2, §4) — the actual next-value work is either (a) acting on Phase 10's deferred VORP-acceptance recommendation once a larger corpus exists, or (b) if a second decision type is wanted, picking ONE concrete, real candidate (Sleeper-waiver is the closest precedent to trade and reuses the same client) and building it end-to-end as its own explicitly-scoped phase — using this ADR as the template, not re-deriving the architecture. Building a second scenario without a real, motivating validation need (the same discipline that drove trade replay's real value) would be building infrastructure for its own sake.

---

## Files changed in this session

- `docs/DECISION_OS_REPLAY_FRAMEWORK_GENERALIZATION_ADR.md` (this document, new)
- `lib/replay-framework/metrics/shared.ts` (new — `bucketize()`, `average()`, `bucketizeSignedMagnitude()`, relocated unchanged from `tradeReplayMetrics.ts`)
- `lib/replay-framework/metrics/tradeReplayMetrics.ts` (modified — imports the relocated helpers instead of defining them locally; zero behavior change)
- `__tests__/replay-framework/metricsShared.test.ts` (new, 7 tests, direct coverage for the relocated module)

No trade-engine file was modified. No calibration math, threshold, or weight was changed. No shadow calibration was enabled. No database (staging or production) was written to this session. `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` remains unset everywhere.
