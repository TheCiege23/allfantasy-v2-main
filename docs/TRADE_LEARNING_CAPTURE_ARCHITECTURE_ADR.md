# ADR — Trade Learning: Live Capture Architecture

**Status:** Proposed and **implemented (Trade Learning Phase 8)**. Schema migration authored and validated offline — **not yet deployed to any environment** (no database connection made during implementation, consistent with this workstream's established rule).
**Branch:** `g15-event-foundation`
**Follows:** `docs/TRADE_LEARNING_DATA_CAPTURE_AUDIT.md` (root-cause audit, corrected `d0ab01590`), `docs/TRADE_LEARNING_CALIBRATED_B0_OWNERSHIP_ADR.md` (the precedent this ADR's format and governance approach deliberately mirrors), `docs/TRADE_LEARNING_SHADOW_ROLLOUT.md`.
**Constraint honored (original ADR turn):** this document proposed no code, no migration, no calibration-math change, so a human could review the design questions before any implementation phase touched the real trade-completion code path.

> **Implementation update (Phase 8):** every decision below was implemented exactly as specified, with one exception discovered during implementation and handled per this phase's own explicit instruction ("if implementation reveals the ADR cannot be implemented as written due to an unforeseen architectural constraint, stop... and do not invent an alternative architecture"): **`AfLeagueTrade.status` never actually transitions to `'expired'` anywhere in the current codebase** — confirmed by repo-wide grep, zero write sites found. The `expired → EXPIRED` mapping itself is implemented (ready to fire correctly if this is ever triggered), but there is no live code path to hook it to. This is documented, not invented around — see `docs/TRADE_LEARNING_DATA_CAPTURE_AUDIT.md`'s implementation-record section for detail. It does not block the other five (of six) status mappings, all of which have real, confirmed transition points and are fully wired.

## Why this needs an ADR and not a direct implementation

The data-capture audit found the trade-learning engine has no producer for the `TradeOfferEvent`/`TradeOutcomeEvent` pair it requires — real trades flow entirely through `AfLeagueTrade`, which has never been connected to it. Wiring that connection touches four genuine design questions, each with real tradeoffs, none of which is a "one obvious answer" bug fix:

1. Should every real trade proposal get a live acceptance-probability prediction computed and logged, and how?
2. How does `AfLeagueTrade.status`'s ten real values map onto `TradeOutcome`'s five, especially the ambiguous ones (`vetoed`, `cancelled`)?
3. What idempotency mechanism prevents duplicate/lost events on retries, given the existing `inputHash`-based dedup was built for a different purpose (caching repeated hypothetical evaluations) and is provably unsafe to reuse here (see §1.3)?
4. What, if anything, happens to the split `Feedback`/`TradeFeedback` finding from the corrected audit?

This is exactly the kind of decision this workstream has consistently required a reviewed ADR for before implementation (the `calibratedB0` ownership question, the `conservative_roster_pattern` Phase 6 fix) — not because any single piece is hard, but because getting the *decision* wrong is expensive to unwind once real data starts flowing under it.

---

## Decision 1 — Should real trade proposals get a live prediction logged?

### 1.1 The problem

`computeShadowB0()` and `computeSegmentB0s()` both filter `TradeOutcomeEvent` on `WHERE "offerEventId" IS NOT NULL` (confirmed unchanged in `lib/trade-engine/auto-recalibration.ts` since Phase 0). An outcome event with no linked offer event is invisible to calibration. Real `AfLeagueTrade` proposals never go through `logTradeOfferEvent()` today — only the five hypothetical-evaluation tools do. Writing an outcome without first writing a linked offer would satisfy "capture something" while accomplishing nothing measurable — the exact trap the Phase 5 audit already identified and declined to fall into.

### 1.2 Options considered

| Option | Description | Assessment |
|---|---|---|
| (a) Score every real proposal at creation time | Call the existing acceptance-probability model (`getCalibratedWeights()` / `core-engine.ts`'s dual-brain analyzer — the same one the 5 hypothetical tools already use) when a real `AfLeagueTrade` is created, translate its `AfLeagueTradeItem` rows into the `assetsGiven`/`assetsReceived` shape `logTradeOfferEvent()` expects, and log it. | **Recommended.** Reuses the existing model unmodified (no calibration-math change); the only new work is an asset-shape adapter, not new scoring logic. This is the only option that produces a real, linkable prediction. |
| (b) Only log when the user already ran a hypothetical evaluation first | Attempt to match an existing `TradeOfferEvent.inputHash` from a prior evaluator-tool call, before creating the real trade. | Rejected as the sole mechanism — most real trades are proposed without first running an evaluator tool, so this would leave the large majority of real trades still unlinked. Could be layered on top of (a) as a cache-hit optimization, not a substitute. |
| (c) Don't log a prediction at all; backfill outcomes with `offerEventId: null` | Simplest to build. | Rejected — produces rows invisible to `computeShadowB0()`/`computeSegmentB0s()`, i.e. does nothing (this is precisely what the data-capture audit warned against). |

### 1.3 Idempotency mechanism (why `inputHash` alone is unsafe for this)

`TradeOfferEvent.inputHash` (`@unique`) is a content hash of `assetsGiven`/`assetsReceived`/`mode`/`leagueId` — built to deduplicate *repeated hypothetical evaluations of the same asset combination* (a legitimate cache-style use). Reusing it as the idempotency key for real proposals is unsafe: two **distinct, unrelated** real trades with identical asset combinations in the same league (plausible — e.g. two separate proposals swapping the same bench players) would collide on the same `inputHash`. Since the column is DB-uniquely constrained, the second real trade's `logTradeOfferEvent()` call would hit `P2002` and silently return `null` (the function's existing, correct behavior for its original purpose) — meaning a distinct real trade would silently lose its offer event. **Recommendation: identify real proposals by `AfLeagueTrade.id`, not by asset-content hash.** This requires a new field (§4).

---

## Decision 2 — `AfLeagueTrade.status` → `TradeOutcome` mapping

Real `AfLeagueTrade.status` values (confirmed via Phase 5's audit): `pending, awaiting_commissioner, awaiting_votes, scheduled, processed, rejected, cancelled, countered, vetoed, expired`. `TradeOutcome` enum: `ACCEPTED, REJECTED, EXPIRED, COUNTERED, UNKNOWN`.

| `AfLeagueTrade.status` | Terminal? | Recommended `TradeOutcome` | Rationale |
|---|---|---|---|
| `pending`, `awaiting_commissioner`, `awaiting_votes`, `scheduled` | No | *(no event written)* | In-progress states are not resolutions. Writing an outcome here would be premature and would need to be corrected/overwritten later — simpler to only write on a genuine terminal transition. |
| `processed` | Yes | `ACCEPTED` | Unambiguous — the trade actually executed (rosters swapped, per `settleRedraftTradeAssets()`). |
| `rejected` | Yes | `REJECTED` | Unambiguous — the receiving side declined. |
| `countered` | Yes (for *this* proposal) | `COUNTERED` | The original proposal's own lifecycle ends here; the counter-offer is a **new**, separate `AfLeagueTrade` row (linked via `parentTradeId`/`rootTradeId`) that gets its own independent offer/outcome pair when *it* resolves. Do not merge the chain into one event. |
| `expired` | Yes | `EXPIRED` | Unambiguous — no decision was made before the deadline. |
| `vetoed` | Yes | **`UNKNOWN`** (not `REJECTED`) | A veto is a commissioner/league-vote *procedural override*, not the receiving manager's own judgment about the trade's fairness. Counting it as an organic rejection would contaminate `computeObservedAcceptRate()`'s signal with non-market data. `UNKNOWN` is already excluded from that calculation by design (Phase 0's fix), which is exactly the right treatment — this is not new logic, just applying the existing, already-tested exclusion convention to a new source. |
| `cancelled` | Yes | **`UNKNOWN`** (not `REJECTED`) | A cancellation reflects the *proposer's* choice to withdraw — it says nothing about whether the receiving side would have accepted or rejected. Same reasoning and same existing exclusion mechanism as `vetoed`. |

This mapping introduces no new enum values on the `TradeOutcome` side and requires no change to `computeObservedAcceptRate()` — it relies entirely on the exclusion behavior already shipped and tested in Phase 0/3.

---

## Decision 3 — Provider independence (confirmed by construction, not a new constraint to design for)

`AfLeagueTrade`/`AfLeagueTradeItem` are already native, provider-agnostic in-app tables — `sleeperUsername`/`sleeperLeagueId` belong only to the separate legacy `LeagueTrade`/`LeagueTradeHistory` import tables, never to `AfLeagueTrade`. Anchoring the capture architecture on `AfLeagueTrade`'s own lifecycle (rather than any provider-specific import or sync process) satisfies "no Sleeper/ESPN-specific logic" by construction — this is a point in favor of Decision 1's recommendation, not a separate design axis requiring its own tradeoff analysis.

---

## Decision 4 — `Feedback`/`TradeFeedback` — explicitly out of scope for this ADR

The corrected data-capture audit found two real, live, disconnected feedback tables (`Feedback`, modern/`userId`-keyed; `TradeFeedback`, legacy/`sleeperUsername`-keyed, read by `calibrateFromFeedback()`). **This ADR makes no recommendation on reconciling them.** It is a genuinely separate question from live trade *outcome* capture (this document's subject), touches `calibrateFromFeedback()` (adjacent to calibration math), and per the audit's own §6 deserves its own follow-up rather than being bundled into capture-architecture implementation. Any future phase implementing this ADR should leave `Feedback`/`TradeFeedback` untouched and simply re-state this as still-open, exactly as the data-capture audit already does.

---

## Schema changes required (additive only, no existing column/table altered)

Two new nullable, uniquely-constrained columns and one new enum value — all additive, mirroring the Phase 2H `RedraftRosterMoveHistory` precedent (hand-authored migration, `prisma validate`/`generate` only, no direct database connection needed to author it):

```prisma
enum TradeOfferMode {
  INSTANT
  STRUCTURED
  TRADE_HUB
  TRADE_IDEAS
  PROPOSAL_GENERATOR
  LIVE_PROPOSAL   // NEW — real in-app trade proposals, distinct from hypothetical-evaluation-tool modes
}

model TradeOfferEvent {
  // ...existing fields unchanged...
  afLeagueTradeId String? @unique   // NEW — real idempotency key for live-captured offers, distinct from content-hash inputHash (see §1.3)
}

model TradeOutcomeEvent {
  // ...existing fields unchanged...
  afLeagueTradeId String? @unique   // NEW — real idempotency key for live-captured outcomes, distinct from the existing ambiguous leagueTradeId (which points at legacy LeagueTrade.id)
}
```

**Alternative considered and rejected:** reuse the existing `leagueTradeId String?` field (present on both tables, no enforced relation) to store the `AfLeagueTrade.id` instead of adding new columns — this would avoid a migration entirely. Rejected because `leagueTradeId` already means "an ID from the legacy `LeagueTrade` table" in every existing row (written by `logAcceptedTradesAsOutcomes()`'s backfill); overloading it to sometimes mean `AfLeagueTrade.id` instead makes every future reader unable to tell which ID space a given row's `leagueTradeId` belongs to without also checking `mode` — fragile and easy to get wrong later. A dedicated field is one small, safe migration in exchange for permanent clarity.

---

## Behavior-preservation strategy (for whoever implements this)

- Compute the real-trade prediction (Decision 1) **outside** the transaction that creates the `AfLeagueTrade` row, then write `TradeOfferEvent` in its own `try`/`catch` immediately after — mirroring the Phase 2H `RedraftRosterMoveHistory` precedent exactly: a learning-write failure must never block or roll back the real trade action.
- Same pattern for the outcome write at each terminal-transition point (accept/reject/veto/cancel/counter/expire) — write `AfLeagueTradeStatusHistory` (already happens today, unchanged) first, then attempt the `TradeOutcomeEvent` write in its own try/catch immediately after.
- Idempotency: check for an existing row by the new `afLeagueTradeId` unique field before inserting; on a `P2002` (race/retry), treat as already-captured and return successfully rather than erroring — mirroring `logTradeOfferEvent()`'s existing `P2002` handling.
- No existing route's request/response shape changes. No existing calibration formula, weight, or threshold changes. No public API added or altered — the new writes are side effects of existing write points, not new endpoints.

---

## Required tests (for the implementation phase)

- Real proposal creation writes exactly one `TradeOfferEvent`, with a real computed `acceptProb` (not a placeholder), `mode: LIVE_PROPOSAL`, and `afLeagueTradeId` matching the created trade.
- A retried/duplicate proposal-creation request does not create a second `TradeOfferEvent` for the same `AfLeagueTrade.id`.
- Each terminal status transition (`processed`, `rejected`, `countered`, `expired`, `vetoed`, `cancelled`) writes exactly one `TradeOutcomeEvent` with the mapping from Decision 2, correctly linked via `offerEventId` to the trade's own `TradeOfferEvent`.
- Non-terminal transitions (`awaiting_commissioner`, `awaiting_votes`, `scheduled`) write no outcome event.
- A trade that transitions through multiple states before reaching a terminal one still produces exactly one outcome event (not one per intermediate transition).
- A simulated failure in the offer/outcome write (e.g., a thrown error inside the try/catch) does not prevent the real trade action (proposal/accept/reject/etc.) from succeeding.
- `computeShadowB0()`/`computeSegmentB0s()`, run against a fixture containing only live-captured events (real `afLeagueTradeId`-linked rows, no legacy-import data), correctly compute a non-null observed rate — proving the new capture path actually feeds the existing, unmodified calibration functions correctly.
- `vetoed` and `cancelled` real trades do not affect `computeObservedAcceptRate()`'s output (confirming they're excluded, not miscounted, exactly as `COUNTERED`/`UNKNOWN` already are per the Phase 0 test suite).

---

## Rollout / risk

- Purely additive schema + new write points at existing, already-reachable real-trade routes — no new endpoints, no existing endpoint's behavior changes for callers.
- Risk is isolated to the trade-completion write paths gaining two new side-effect writes each, both wrapped in non-blocking try/catch per the behavior-preservation strategy above.
- Does not by itself change any calibration output — `computeShadowB0()`/`promoteShadowB0()` remain gated behind `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` (still unset everywhere) and their existing sample-size/maturity/divergence gates, unchanged by this ADR.
- Once implemented, Phase 4's staging measurement should be re-run — this is the first change in the entire workstream that could plausibly make that measurement's zero counts start moving.

---

## Explicit non-goals (unchanged by Phase 8's implementation)

- `calibrateInterceptFromOutcomes()`, `calibrateFromFeedback()`, `promoteShadowB0()`, and every calibration formula/weight/threshold: untouched.
- Decision OS, AI Coach, Chimmy: untouched. No public API added or changed.
- The `Feedback`/`TradeFeedback` question (Decision 4): still explicitly deferred, not resolved by this implementation.
- `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED`: still unset everywhere.

---

## Implementation record (Phase 8)

- **Schema**: `TradeOfferMode.LIVE_PROPOSAL` added; `TradeOfferEvent.afLeagueTradeId`/`TradeOutcomeEvent.afLeagueTradeId` (both nullable, unique) added. Migration `prisma/migrations/20260705010000_add_trade_learning_live_capture/migration.sql`, hand-authored, `prisma validate`/`generate` run offline — **not deployed to any environment**.
- **Prediction capture**: `lib/league-trade-engine/tradeLearningCapture.ts` (new) — `captureLiveTradeOffer()` reuses `computeTradeDrivers()` + `calibrateAcceptProbability()` (the same deterministic pipeline `runCoreEngine()` uses internally, minus its AI-narrative/negotiation-toolkit layer) with zero new prediction math. Resolves `AfLeagueTradeItem`s via the existing `findPlayerBySleeperId`/`getPickValue`/`fetchFantasyCalcValues` helpers, with the same flat-default-value fallback convention `lib/trade-learning.ts`'s `analyzeHistoricalTrade()` already uses for unresolvable assets.
- **Outcome capture**: `captureLiveTradeOutcome()` implements Decision 2's mapping exactly (`processed→ACCEPTED`, `rejected→REJECTED`, `countered→COUNTERED`, `expired→EXPIRED`, `vetoed→UNKNOWN`, `cancelled→UNKNOWN`), looks up the linked offer by `afLeagueTradeId`, writes with `offerEventId` set.
- **Wiring**: `lib/league-trade-engine/tradeService.ts` calls these at every real, confirmed transition point (`createAfLeagueTrade`, the counter-parent update, `finalizeAfLeagueTradeProcessing`, `commissionerAfTradeDecision`'s reject branch, `rejectAfLeagueTrade`, `cancelAfLeagueTrade`, `castAfTradeVetoVote`'s threshold branch) — all `await`ed after the real state change (outside any transaction), all fail-safe internally (never throw).
- **Idempotency**: both new `afLeagueTradeId` columns are uniquely constrained; `logTradeOfferEvent()`/`logTradeOutcomeEvent()` catch `P2002` and return the already-captured row's id instead of erroring.
- **Tests**: 26 new tests across three files (`trade-learning-capture.test.ts`, `league-trade-engine-live-capture-wiring.test.ts`, `live-capture-calibration-integration.test.ts`) — see `docs/TRADE_LEARNING_DATA_CAPTURE_AUDIT.md` for the full list and verification results.

---

## Files changed in this session

- `docs/TRADE_LEARNING_CAPTURE_ARCHITECTURE_ADR.md` (this document, updated with the implementation record above)
- `prisma/schema.prisma` (modified — additive: `LIVE_PROPOSAL` enum value, two new `afLeagueTradeId` columns)
- `prisma/migrations/20260705010000_add_trade_learning_live_capture/migration.sql` (new)
- `lib/trade-engine/trade-event-logger.ts` (modified — extended `TradeOfferMode`/`TradeOutcomeStatus` unions, added `afLeagueTradeId` to both input/write paths, added idempotent `P2002` handling)
- `lib/league-trade-engine/tradeLearningCapture.ts` (new)
- `lib/league-trade-engine/tradeService.ts` (modified — wired capture calls at 7 real call sites)
- `__tests__/trade-engine/trade-learning-capture.test.ts` (new)
- `__tests__/league-trade-engine-live-capture-wiring.test.ts` (new)
- `__tests__/trade-engine/live-capture-calibration-integration.test.ts` (new)
- `docs/TRADE_LEARNING_DATA_CAPTURE_AUDIT.md` (updated)

No calibration formula/weight/threshold, Decision OS code, AI Coach, Chimmy, or public API was touched. No database was queried or connected to — the migration was authored and validated offline only.
