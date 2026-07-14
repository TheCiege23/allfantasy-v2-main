# Fantasy Knowledge Graph — Foundation (Phase 3)

Implements Milestone 3 of [`docs/os/ALLFANTASY_FANTASY_OS_MIGRATION_PLAN.md`](../../../docs/os/ALLFANTASY_FANTASY_OS_MIGRATION_PLAN.md), scoped strictly to Part 15 Phase 1 of [`docs/os/ALLFANTASY_FANTASY_KNOWLEDGE_GRAPH_SPEC.md`](../../../docs/os/ALLFANTASY_FANTASY_KNOWLEDGE_GRAPH_SPEC.md). Follows Phase 1 ([Identity Service](../identity/README.md)) and Phase 2 ([Sleeper import hardening](../../league-import/sleeper/README.md)).

## What was built

**Real, verified signal emission points — not assumed.** Before writing any code, the actual trade and waiver resolution paths were read in full:
- `lib/league-trade-engine/tradeService.ts` — `finalizeAfLeagueTradeProcessing` (accepted), `commissionerAfTradeDecision`'s reject branch, `rejectAfLeagueTrade`, `cancelAfLeagueTrade`, `castAfTradeVetoVote`. All five already call an existing observational hook, `captureLiveTradeOutcome` (feeding the separate Trade Learning system) — this phase's own signal capture (`recordTradeOutcomeSignal`, in `TradeSignalHook.ts`) sits immediately next to each of those five calls, following the exact same "never block the real transaction" convention.
- `lib/waiver-wire/process-engine.ts` — the shared `pushFail` helper (covers every waiver-loss branch in one hook) and the successful-claim path (right next to the existing `recordAfLearningEvent` hook, same pattern).

**Signal capture** (`SignalIngestionService.ts`, `TradeSignalHook.ts`, `WaiverSignalHook.ts`) — six signal types: `trade_accepted`, `trade_rejected`, `trade_cancelled`, `trade_vetoed`, `waiver_claim_won`, `waiver_claim_lost`. Every capture call is wrapped so a Knowledge Graph failure can never affect a real trade or waiver transaction (double-wrapped, in fact — both the hook and the ingestion function catch independently).

**Entity/relationship model** (`types.ts`) — `Signal` (immutable, append-only), `ConfidenceEnvelope` (confidence, freshness, evidence, sample size, source attribution, risk, uncertainty — all seven fields, none optional), `VersionedDerivation<T>` (the `as_of`/`computed_at` pattern from the spec's Part 7, never overwritten).

**Exactly two aggregates**, as scoped:
- `ManagerBehaviorProfile` (`ManagerBehaviorProfileEngine.ts`) — trade/waiver counts and rates, derived purely from a manager's own signal history.
- `PlayerExposure` (`PlayerExposureEngine.ts` + `RosterSnapshotLoader.ts`) — computed from the manager's **current roster state** across every league they're in (queried live from the existing `Roster` table, not derived from signals — see "Design decisions" below for why).

**Privacy gate** (`PrivacyGate.ts`) — minimum cohort of 20 distinct leagues, enforced unconditionally before either aggregate ships, per the phase brief. See "Interpretation choice" below.

**Query Service** (`QueryService.ts`) — the only read path (`getManagerBehaviorProfile`, `getPlayerExposure`); the only write path is `SignalIngestionService.ts`. No other module reads `SignalStore`/`SnapshotStore` directly.

## Design decisions worth understanding

**PlayerExposure reads current roster state, not a replay of signals.** The spec describes Player Exposure as derived from roster-add/drop signals, but this phase does not capture generic roster-add/drop events (only trade- and waiver-driven roster changes are captured, via the trade/waiver hooks above — a plain in-league roster edit isn't hooked yet). Deriving "what does this manager currently roster" by replaying every historical signal from scratch would be far more complex and error-prone than querying the `Roster` table's current `playerData` directly — which the app already maintains as the source of truth. Signals still matter for exposure indirectly (they're what change roster state in the first place), but the aggregate itself is a live snapshot query, not a signal replay. This is a deliberate scope decision, not an oversight.

**Interpretation choice on the privacy gate, disclosed:** the spec's own text scopes the cohort gate to aggregates "surfaced to a third party," exempting a manager's own self-view and their commissioner's view. This phase's brief says "no aggregate ships without satisfying the gate" with no listed exception. Since there's no real auth/permission wiring yet to correctly distinguish "self" from "third party," this phase takes the **strict** reading: the gate is unconditional, checked against a platform-wide distinct-league count. Loosening this once real caller identity exists (so a manager can always see their own profile regardless of platform-wide volume) is a deferred follow-up, not built here. The `QueryOptions.visibility` field is threaded through every Query Service function already, ready for that refinement.

**No new production schema/migration in this phase.** `SignalStore` and `SnapshotStore` are real, fully-tested TypeScript interfaces — but this phase ships only an **in-memory implementation**, explicitly disclosed as non-durable (state is lost on every process restart, which in this app's deployment model is most requests). This matches the established precedent already set by this exact codebase's own history (see project memory `sleeper-import-hardening`: real schema changes go through a proposal document + explicit approval + a real test database before landing, not directly into `schema.prisma`). The real Prisma models this would migrate to are specified in [`docs/os/FANTASY_KNOWLEDGE_GRAPH_SCHEMA_PROPOSAL.md`](../../../docs/os/FANTASY_KNOWLEDGE_GRAPH_SCHEMA_PROPOSAL.md) — a proposal, not yet approved or migrated. Swapping the in-memory store for a Prisma-backed one requires no change to any caller, since every caller goes through the `SignalStore`/`SnapshotStore` interfaces, never a concrete class.

**Confidence heuristics are documented placeholders, not statistical rigor.** `confidence = min(1, sampleSize / 20)` for ManagerBehaviorProfile and `min(1, leagueCount / 10)` for PlayerExposure are simple, disclosed heuristics — reasonable for a foundation phase, explicitly not claimed to be more than that. `risk = 1 - confidence` is the same. PlayerExposure's `uncertainty` band uses a standard Wald interval (a real, common approximation for a proportion) since exposure share is a single scalar; ManagerBehaviorProfile's `uncertainty` is `null` because it's a multi-metric profile (trade rate and waiver rate are independent) with no single natural interval — computing one anyway would have been fabricated precision.

## What remains unsupported / deferred — documented honestly

- **No real (Prisma-backed) persistence yet** — see above. This is the single biggest gap between "foundation" and "production-ready."
- **Proposer-vs-receiver role is not distinguished** in trade signals — both managers in a trade get the same signal type today. A future refinement, not built here (see `TradeSignalHook.ts`'s docstring).
- **No generic roster-add/drop signal capture** — only trade- and waiver-driven roster changes are observed. A plain commissioner-initiated roster edit, IR move, etc. does not emit a signal yet.
- **The other ~13 derived-intelligence types from the spec's Part 5** (League Economy Profile, Legacy Snapshot, FormatStrategyPattern, TradeOutcomeAggregate, CommissionerEngagementPattern, etc.) are **not built** — out of scope for this phase, per the brief.
- **Trade OS, Waiver OS, Legacy pages, Game Day, Commissioner OS, Specialty League OS, and additional providers** were not touched, per the brief.
- **No caller yet.** `QueryService.getManagerBehaviorProfile`/`getPlayerExposure` are real, tested, and callable — but nothing in the app calls them yet. That's the natural next connection point.

## How later Trade/Waiver/Legacy/Game Day systems will consume this

Per the architecture spec's OS module boundaries, every future OS module reads Knowledge Graph data **only** through `QueryService.ts` — never through `SignalStore`/`SnapshotStore` directly, and never by re-deriving their own competing version of "how aggressive is this manager" (the exact duplication pattern the pivot audit found five times over in the trade/waiver space). Concretely:
- **Trade OS** (Milestone 4) will call `getManagerBehaviorProfile` to inform mutual-benefit scoring with a manager's real trade tendency, instead of the ad-hoc `manager-tendency-engine.ts` several of today's five competing trade systems each maintain independently.
- **Waiver OS** (Milestone 5) will call the same function for waiver-aggressiveness context.
- **Game Day OS** (Milestone 7) will call `getPlayerExposure` directly for its cross-league exposure view — this is the same capability the pivot audit found already built but orphaned (`lib/portfolio-manager`); this phase's `PlayerExposure` is a from-scratch replacement built on the real Knowledge Graph contract, not a revival of the orphaned code.
- **Legacy OS** (Milestone 6) will eventually read accumulated `ManagerBehaviorProfile` history (once real persistence lands) for career-long tendency narratives.
- **Commissioner OS** (Milestone 8) will read League-level aggregates once those are built (not in this phase).
