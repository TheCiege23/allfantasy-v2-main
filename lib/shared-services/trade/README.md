# Trade Service — Shadow Build (Phase 5)

First real step of Trade OS consolidation, per the locked Migration Plan's zero-downtime pattern. Follows Phase 1 ([Identity Service](../identity/README.md)), Phase 2 ([Sleeper import hardening](../../league-import/sleeper/README.md)), Phase 3 ([Knowledge Graph foundation](../knowledge-graph/README.md)), and Phase 4 ([provider-neutral trade context](../../trade-engine/PROVIDER_NEUTRALITY_README.md)).

## Audit finding before any code was written

What the original pivot audit called "5-6 competing trade systems" collapses to exactly **two independently-computed scoring engines** once traced to their real call chains:

| System | Real entry point | Real consumers |
|---|---|---|
| **T2** | `lib/trade-value/grader.ts`'s `gradeTrade()`, via `snapshot.ts`'s `buildTradeValueSnapshot()` | `app/api/redraft/trade-proposals` (native redraft trade proposals) |
| **trade-engine.ts** | `computeTradeDrivers()` | `trade-evaluator`, `trade-finder`, and the legacy `goal-proposals`/`league-analyze` routes (via `lib/league-decision-context.ts`'s separate context, or Phase 4's assembler) |

Two more things on the original list are **not** independent scoring engines:
- **Trade Finder's client-side `computeTradeGrade`** (`components/TradeFinderClient.tsx`) is a display-only letter-grade/color-class formatter over numbers already computed server-side — not a third scorer.
- **Decision OS's own trade slice** (`lib/decision-os/trade/decision.ts`) wraps T2's `buildTradeValueSnapshot()` directly, mapping it into a generic `Decision<TradeEvaluation>` object (matching the Decision OS core contract: `four_answers`, `confidence`, `data_completeness`, `rule_verdicts`). It's a real, already-isolated shadow layer for native trades — not a fourth independent formula to converge with.

## What is now shadowed

`lib/shared-services/trade/TradeShadowService.ts`'s `evaluateTradeShadow()` — callable, real, tested, **zero live callers**. For a given trade:
1. Fetches provider-neutral context via Phase 4's `buildLeagueDecisionContext` (works for any of the six registered providers).
2. Reuses `trade-engine.ts`'s real `computeTradeDrivers()` as its own primary fairness/grade value — **no new scoring formula was invented**. The genuinely new capability this phase adds is that this real algorithm now runs on provider-neutral data, not that it computes anything differently.
3. Runs T2's real `gradeTrade()` in parallel (adapted input — see `LegacyGraderAdapters.ts`'s docstring for the one disclosed approximation: `projectionValue` isn't available from the provider-neutral context, so T2's own confidence computation reflects that gap honestly rather than being masked) and logs the **divergence** between the two real, independently-computed fairness scores.
4. Enriches with the Fantasy Knowledge Graph's real `getManagerBehaviorProfile()` (Phase 3) for both sides — honestly reporting `ok` / `gated` / `unavailable`, never fabricating tendency data.
5. Logs the full result to an in-memory `ShadowResultStore` (same disclosed non-durable pattern as Phase 3's Knowledge Graph stores — a real persistence decision for whoever does full consolidation, not decided here).

## What remains live-authoritative (unchanged, untouched)

- **T2** (`grader.ts`/`snapshot.ts`/`captureSnapshot.ts`) still grades every real native redraft trade proposal exactly as before.
- **trade-engine.ts's `computeTradeDrivers`/`runTradeEngine`** still power `trade-evaluator`, `trade-finder`, and the legacy routes exactly as before.
- **`lib/league-decision-context.ts`** (the Phase-4-discovered duplicate context builder) is still what those three routes use for context — this phase's provider-neutral assembler is a *different* file; reconciling the two is a decision for whoever does full consolidation, not made here.
- **Decision OS's trade slice** still wraps T2 for native trades, independent of this shadow service.
- **No route, API response, or UI changed.** Verified via the full existing test suite (trade-engine's 81 tests, the trade-proposals/trade-evaluator/trade-finder route tests, the live-capture-wiring test) re-run with zero regressions.

## Known divergence categories

From `ShadowEvaluationEngine.ts`'s `buildDivergence()`:
- **Broad agreement** (`|Δfairness| ≤ 5`): the two independent algorithms concur — a reassuring signal for eventual consolidation.
- **Large divergence** (`|Δfairness| ≥ 20`): flagged with an explicit note recommending manual review before any consolidation decision leans on either number for that specific trade shape.
- **Legacy grader failure**: T2 (or, in a future extension, any additional comparison grader) throwing is captured as a `null` delta with the error message preserved — never silently treated as "0 divergence," and never allowed to fail the whole shadow evaluation (this is the one *comparison-only* dependency in the pipeline; a genuine failure of the *primary* value — `computeTradeDrivers` itself — is intentionally NOT caught, since a shadow evaluation with no real primary value has nothing meaningful to return, and nothing live depends on this call yet to be protected from that failure).

## Minimum parity threshold before migrating the first consumer

Not yet established with real data — this phase built the *capability* to measure divergence, not the corpus to judge it against. Before migrating any live consumer (e.g., pointing `app/api/redraft/trade-proposals` at this service instead of T2 directly), the recommended next step is:
1. Run `evaluateTradeShadow` against a real historical-trade corpus (a script, not built in this phase — same "not yet executed live, no DB access in this sandbox" caveat as Phase 3's Knowledge Graph work).
2. Use `ShadowResultStore.findDiverging(threshold)` to inspect the actual distribution of real divergence, not a guessed number.
3. A reasonable starting bar — **no worse than 10% of real historical trades showing `|Δfairness| ≥ 20`** — is a plausible target based on the buckets already defined above, but this is a proposed starting point for whoever runs the real backtest, not a validated threshold.

## Known gaps carried forward from Phase 4

Every Phase 4 gap applies identically here, since this service is built directly on that context: `taxiSlots` is Sleeper-only-precise, manager-tendency pre-analysis caching (the OLD Sleeper-specific one, distinct from this phase's Knowledge Graph enrichment) doesn't run for non-Sleeper providers, and Fantrax/Fleaflicker player-identity/roster-position data remains sparse. Additionally: `managerKey` (used for the Knowledge Graph lookup) is the roster's provider-scoped manager id (`source_manager_id`) — this only aligns with the Knowledge Graph's own signal-capture `managerKey` (native `Roster.platformUserId`, per Phase 3) for native/Sleeper-linked leagues today; bridging this properly is a future Identity Service (Phase 1) reconciliation task, not solved in this phase.
