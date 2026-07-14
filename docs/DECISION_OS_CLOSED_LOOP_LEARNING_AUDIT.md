# Decision OS — Closed-Loop Learning Audit

**Status:** Documentation only. No code, schema, migration, or API changes made in this session.
**Branch:** `g15-event-foundation`
**Builds on:** `docs/DECISION_OS_ARCHITECTURE_CHECKPOINT_JULY_2026.md` (the architectural baseline this audit assumes as read)
**Scope of this document:** whether ANY part of the platform — Decision OS or otherwise — closes the loop from recommendation → user action → real-world outcome → recalibrated future recommendation. Every claim below was verified directly against source (file, line, or schema), not inferred from naming.

## TL;DR

**One real closed-loop calibration mechanism exists in the codebase — narrower than it looks, and split across a wired-but-partly-fake path and a correct-but-fully-orphaned path.** Everywhere else, "learning" means *collecting data and handing it to Claude as prompt context* or *computing a fresh deterministic score each time* — never adjusting a weight, threshold, or confidence value based on what actually happened. Decision OS itself has zero learning components: `Decision.confidence` and `DecisionOSInsight.confidence`/`dataCompleteness` are asserted-range static values, computed once per request and discarded. The single most valuable, cheapest fix available today is not new infrastructure — it's flipping a dead switch (§5.2).

---

## 1. Recommendation Inventory

Every place in the codebase that produces a ranked suggestion, verdict, or "you should do X" output, classified by origin and reviewed for overlap.

### 1.1 Decision OS (`lib/decision-os/phase6/recommendations/`)
`assembleManagerRecommendations()` — deterministic, evidence-linked recommendations (trade_coaching, waiver_strategy, lineup_discipline, engagement_boost categories) derived from Phase 6.1/6.2 pattern + DNA outputs. Live via `resolveManagerIntelligencePayload` → `GET /api/decision-os/manager-intelligence`, consumed by Dashboard, League Home, Commissioner Hub. **No learning**: same inputs always produce the same recommendation; nothing about past acceptance changes future output.

### 1.2 Trade domain (heavy duplication)
| System | File | What it recommends | Learns from outcomes? |
|---|---|---|---|
| Trade Analyzer / dual-brain engine | `lib/trade-engine/dual-brain-trade-analyzer.ts`, `core-engine.ts` | ACCEPT/REJECT/LEAN verdict + grade for a proposed trade | Partially — see §5 |
| Acceptance model | `lib/acceptance-model.ts` | Raw 0.05–0.95 acceptance probability (logistic, hardcoded weights: fairness 0.8, ldi 0.6, needs 0.7, archetype 0.5, dealShape 0.4, volatility −0.5, intercept −4) | No — static, distinct from and not connected to the trade-engine calibration system in §5 |
| Smart Trade Recommendations | `lib/smart-trade-recommendations.ts` | Acquire/sell/swap suggestions from a Sleeper-history-derived trading-style profile | No — static FantasyCalc valuations, no outcome read |
| Trade Alternatives | `lib/trade-alternatives.ts` | Refinement options when an initial proposal is rejected | No, but not duplicative — complementary refinement layer |
| Trade AI DM Service | `lib/trade-ai-dm/TradeAIDMService.ts` | Sends a private-message verdict on a received offer | No — deterministic verdict |
| Comprehensive Trade Learning / Trade Learning | `lib/comprehensive-trade-learning.ts`, `lib/trade-learning.ts` | Retrospective market-trend analysis surfaced as prompt context (`getLearningContextForAI()`) | Feeds text into prompts only, EXCEPT for the calibration functions it orchestrates — see §5 |

**Verdict:** `smart-trade-recommendations.ts` is a direct, confirmed duplicate of Decision OS's `trade_coaching` category — both independently derive a trade archetype/suggestion set from raw Sleeper history with no shared source of truth. `acceptance-model.ts` and the trade-engine's own internal acceptance probability are two **separate, uncoordinated** acceptance-likelihood models for the same concept.

### 1.3 Waiver domain
`lib/ai/waivers/waiverRecommendationService.ts` → `generateWaiverRecommendations()`, live via `app/api/ai/waivers/recommend/route.ts`. Returns 3–5 ranked add/drop suggestions with confidence + suggested FAAB bid. Falls back to static stubs on data gaps. **No learning**: no outcome (was the pickup good?) is ever read back in.

### 1.4 User/league discovery domain
- `lib/user-recommendation-engine/UserRecommendationEngine.ts` — aggregates 30-day tool-usage/engagement events into league/player/strategy suggestions. Overlaps with Decision OS's `engagement_boost` category (both infer engagement recommendations from activity counts, from two different pipelines).
- `lib/league-recommendations/LeagueRecommendationEngine.ts` — league-discovery matching by format/scoring/size. Distinct purpose from Decision OS; not duplicative.
- `lib/saved-recommendations/SavedRecommendationsService.ts` — designed as a universal recommendation-persistence sink; **incomplete Prisma migration, mutations currently no-op**. Confirmed still a scaffold.

### 1.5 Everything not built as a recommendation system
No dedicated confidence-scored start/sit or draft-recommendation engine was found as a standalone module; those flows compose from the trade/waiver/lineup primitives above plus direct Claude prompting.

### 1.6 Classification summary

| Classification | Systems |
|---|---|
| **Decision OS (canonical target)** | `phase6/recommendations` |
| **Legacy / duplicated** | `smart-trade-recommendations.ts` (vs. trade_coaching), `user-recommendation-engine` (vs. engagement_boost), two independent acceptance-probability models |
| **Complementary, not duplicative** | `trade-alternatives.ts`, `league-recommendations`, waiver recommendation service |
| **Experimental / incomplete** | `saved-recommendations` (no-op scaffold) |

---

## 2. Outcome Tracking

Where REAL results (not predictions, not recommendations) get recorded, and whether any of them reference a prior recommendation.

| Domain | Real outcome stored? | Model | Linked to a recommendation ID? |
|---|---|---|---|
| Lineup | No persistence — `lib/decision-os/lineup/outcome.ts`'s `recordLineupOutcome()` emits telemetry only, comment explicitly states "MINIMAL placeholders only… full Learning/Decision-Quality system is a later slice" | none | N/A |
| Waiver | Yes, but generic | `WaiverTransaction`, `WaiverRun`, `WaiverClaim` | No — no `recommendationId` field anywhere in the waiver schema |
| Trade (pre-decision) | Yes | `TradeOfferEvent` (acceptProb, verdict, grade, featuresJson) | Self-contained; not read by lineup/waiver systems |
| Trade (resolved) | Yes | `TradeOutcomeEvent` (outcome: accepted/rejected/vetoed/completed, `offerEventId` FK back to the offer) | **Yes — this is the one real recommendation→outcome link in the codebase** (see §5) |
| Season/Championship | Yes | `SeasonResult` (wins/losses/pointsFor/pointsAgainst/champion), `LeagueDynastySeason.metadata` (playoff finish) | No — no reference to any decision made during the season |
| Matchup prediction accuracy | **No bridge exists** | `MatchupPredictionEngine.predictMatchupDeterministic()` (winProbabilityA/B, confidenceBand) is ephemeral/display-only and never persisted; `MatchupFact` stores only the final score, with no column for the pre-game prediction it could be compared against | N/A — the single clearest opportunity for a prediction-accuracy feedback signal in the whole platform, and it does not exist |
| General AI recommendations | Insert-only, generic | `AiRecommendationOutcome` (recommendationId, followed, outcomeScore) | Schema supports it, but **nothing in the codebase calls `trackRecommendationOutcome()` or `resolveRecommendationOutcome()` except the admin metrics reader itself** — it is a write path with no real writers |

**Conclusion:** `TradeOutcomeEvent ↔ TradeOfferEvent` is the only outcome table in the entire platform that is (a) populated from real user action and (b) foreign-keyed back to the specific prediction that preceded it. Every other outcome-recording system is either a display-only historical record (SeasonResult, MatchupFact) or a generic table nobody writes to (AiRecommendationOutcome).

---

## 3. Feedback Collection

| Signal | Captured? | Storage | Read by anything beyond display/prompt-context? |
|---|---|---|---|
| Trade thumbs up/down | Yes | In-memory `lib/feedback-store.ts` (capped 500, session-scoped) AND persisted `TradeFeedback` (Prisma: rating 1–5, aiGrade text, youGive/youReceive, leagueId) | **Yes** — `TradeFeedback` is read by the trade-engine calibration system (§5) in addition to `trade-feedback-profile.ts`'s prompt-context summarization |
| Chimmy chat feedback | Yes | `ChimmyIntelligenceFeedback` (eventType: thumbs_up/down/expand/collapse/dismiss/view; reason; surface) | No — telemetry only |
| AI action lifecycle (shown/clicked/confirmed/completed) | Yes | Logged via `lib/chimmy-actions/AIActionLogger.ts` to `/api/ai/actions/events` | No — fire-and-forget, never queried back |
| Manual lineup override vs. AI/optimizer suggestion | **No** | — | N/A — no field anywhere records that a manager set a different lineup than what an optimizer suggested |
| Waiver claim "followed AI suggestion" | **No** | — | N/A — `WaiverClaim` has no such flag |
| Commissioner override (waiver) | Yes | `WaiverClaim.metadata.commissionerOverrides` (JSON: bypassInsufficientFaab, bypassWeeklyDropLimit, setByUserId) | Read by eligibility checks only, not learning |
| Commissioner override (trade) | **No** | — | N/A — no dedicated override log distinct from `LeagueTrade.status` |

**Conclusion:** Real feedback capture exists and is broader than a prior pass of this workstream assumed — but of every signal captured, only `TradeFeedback` feeds anything beyond prompt text or a UI badge.

---

## 4. Confidence System Audit

| System | Field | Category |
|---|---|---|
| Decision OS `Decision.confidence` | 0–100 | **(a) Static** — computed once at emit time, asserted in-range, never recalibrated |
| Decision OS `DecisionOSInsight.confidence` / `.dataCompleteness` | 0–100 each | **(a) Static** |
| Waiver `ScoredWaiverTarget.compositeScore` + dimension scores | 0–100+ | **(b) Evidence-based-but-uncalibrated** — fixed formula from current inputs, no historical adjustment |
| Matchup `winProbabilityA/B` + `confidenceBand` | 0–1 / tight-normal-wide | **(b)** — Normal-CDF of projected-score spread with a static variance multiplier; never checked against actual results (§2) |
| `acceptance-model.ts` (`acceptanceProbability`) | 0.05–0.95 | **(b)** — hardcoded weights, no recalibration path at all |
| Trade-engine acceptance probability | 0.02–0.95 | **Mixed — (b) and (c) in the same module.** See §5 for the exact split |
| `TradeOfferEvent.confidenceScore` / `.confidenceLabel` | Int / string, nullable | **Unpopulated** — columns exist in schema, no code path found that writes them |

---

## 5. Learning Engine Determination — the one real (and one fake-real) mechanism found

This is the central finding of the audit. Everything below was verified by reading the actual source, not the docstrings or function names, because the naming in this subsystem is actively misleading.

### 5.1 The subsystem: `lib/trade-engine/{accept-calibration,auto-recalibration,isotonic-calibrator,drift-detection}.ts`, orchestrated by `lib/trade-learning.ts`

All four files write to/read from one shared row: `TradeLearningStats` (season-scoped: `calibratedB0`, `calibrationHistory`, `feedbackWeightAdj`, `shadowB0`, `shadowB0Metrics`, `segmentB0s`, `isotonicMapJson`, `driftReport`).

**What is actually wired to a live endpoint** (`POST /api/internal/analyze-trades`, gated by an `x-internal-key` header match against `SESSION_SECRET` — confirmed **not present in `vercel.json`'s cron list**, i.e. reachable only by a manual authenticated call, not on any schedule):

`runBackgroundTradeAnalysis()` (`lib/trade-learning.ts:552`) calls, in order:
1. `processUnanalyzedTrades()` — real: re-derives FantasyCalc values for historical `LeagueTrade` rows, stores `analysisResult`.
2. `runFullCalibration()` (`accept-calibration.ts:435`), which calls:
   - `calibrateInterceptFromOutcomes()` (`accept-calibration.ts:90`) — **despite its name, this function never reads `TradeOutcomeEvent` at all.** It queries `LeagueTrade` for analyzed trades, computes the average *predicted* acceptance probability, and shifts the B0 intercept to match a **hardcoded constant, `const OBSERVED_ACCEPT_RATE = 0.85`** (line 8). There is no query against real outcome data anywhere in this function. It is calibrating toward a fiction, not reality.
   - `calibrateFromFeedback()` (`accept-calibration.ts:189`) — **this one is real.** It reads actual `TradeFeedback` rows (rating 1–5 + `aiGrade` text) from the last 90 days and, via a keyword-matching heuristic (`aiGrade.includes('accept'|'reject'|'likely'|...)` cross-referenced against `rating`), nudges `w1`/`w3`/`w6` feature-weight adjustments by ±2% per signal, clamped to ±0.15. This is genuine, if crude, feedback-driven weight adjustment.
3. `runDriftDetection()` (`drift-detection.ts:609`) — computes calibration/rank-order/segment/input drift alerts. **Its calibration and segment drift metrics reuse the same hardcoded `OBSERVED_ACCEPT_RATE = 0.85` constant** (line 96) as the "ground truth" to measure gap against. Only its rank-order metric's `feedbackConcordance` sub-score reads real `TradeFeedback` data.
4. `logAcceptedTradesAsOutcomes()` — backfills `TradeOutcomeEvent` rows from accepted trades (real data write, but not itself a learning step).

**What genuinely reads real outcomes and would constitute the closed loop — but is never called from anywhere in the codebase:**

`auto-recalibration.ts`'s `computeShadowB0()`, `promoteShadowB0()`, `computeSegmentB0s()`, all orchestrated by `runWeeklyRecalibration()` (line 395). This function:
- Queries real `prisma.tradeOutcomeEvent.findMany()` outcomes, computes a genuine observed accept rate (`accepted`/`completed` count over total).
- Computes a log-odds correction between that real observed rate and the average predicted `acceptProb` from the matched `TradeOfferEvent` rows.
- Holds the correction as a "shadow B0" for a 7-day maturity window, promotes it to the live `calibratedB0` only if divergence from the current value is ≤0.40 and the shadow is ≥30 samples.
- Also computes per-segment B0s (SuperFlex/1QB/TE-premium, ≥50 samples each) and a real isotonic (PAVA) probability-mapping correction via `isotonic-calibrator.ts`'s `computeAndStoreIsotonicMap()`.

A repo-wide grep confirms `runWeeklyRecalibration` has exactly one reference in the entire codebase: its own definition. **It is fully orphaned — built, correct, and never invoked by any route, cron, or script.**

### 5.2 The net effect

- The version of "trade calibration" that is reachable in production uses a **fake constant** for its outcome-based intercept shift and its drift-detection calibration/segment checks.
- The version that would use **real** `TradeOutcomeEvent` data, with proper statistical safety rails (sample-size gates, maturity delay, divergence caps, segment-awareness, isotonic mapping) — i.e., exactly the kind of engineering a production learning system should have — **exists, was clearly built with care, and is dead code.**
- The one part of the reachable path that is genuinely real is `calibrateFromFeedback()`'s feature-weight nudging from `TradeFeedback`, and the rank-order drift metric's feedback-concordance check.
- **Decision OS itself has none of this.** No Decision OS confidence value, threshold, or classifier weight is adjusted by anything in `auto-recalibration.ts`, `accept-calibration.ts`, or any other file — the trade-engine calibration system is entirely local to the legacy trade engine and has zero awareness of or connection to `lib/decision-os/`.

### 5.3 Canonical learning candidate

If one were designated: **`auto-recalibration.ts`'s `runWeeklyRecalibration()` pipeline** is the only component in the codebase that already contains a statistically sound closed-loop design (outcome→correction→maturity-gated promotion→segment/isotonic refinement). It needs zero new design work — it needs exactly one thing: to be called by something. That is the cheapest, highest-leverage fix identified in this audit (see §7, Step 0).

---

## 6. Closed Loop — link-by-link status

The canonical loop: **Recommendation → User Action → Outcome → Feedback → Learning → Updated Confidence → Future Recommendation.**

| Link | Status | Evidence |
|---|---|---|
| Recommendation emitted | ✅ Exists (many systems, §1) | Decision OS, waiver service, trade analyzer all emit recommendations |
| → User Action captured | ⚠️ Partial | Trade accept/reject captured (`TradeOutcomeEvent`); waiver/lineup manual-vs-suggested action **not** captured anywhere (§3) |
| → Outcome recorded | ⚠️ Partial | Trade outcome yes; season/championship yes but unlinked; matchup prediction-vs-actual **does not exist** (§2) |
| → Feedback collected | ✅ Exists for trades/Chimmy | `TradeFeedback`, `ChimmyIntelligenceFeedback` (§3) |
| → Learning computed from outcome+feedback | ⚠️ **Built but not running** | `runWeeklyRecalibration()` computes this correctly; is dead code (§5) |
| → Confidence/weight updated | ⚠️ Partial, and partly fake | `calibrateFromFeedback()` genuinely updates weights from real feedback; `calibrateInterceptFromOutcomes()` "updates" against a hardcoded constant, not reality |
| → Future recommendation reflects the update | ✅ For the parts that do update | `getCalibratedWeights()` is read by live trade-evaluation routes and does apply whatever is currently stored — the code path is correct, only the upstream inputs are compromised |
| Decision OS's own loop | ❌ Does not exist | No stage above touches `lib/decision-os/`; its confidence values are static end to end |

**Bottom line:** the loop is not "absent" — it is a real, mostly-built pipe with one segment silently plugged with a fake value and one segment (the correct one) disconnected entirely. This is a materially different, more actionable finding than "no learning system exists."

---

## 7. Roadmap — Decision OS Learning Engine v1

Ordered by leverage-per-unit-effort, not by dependency order — Step 0 does not require Step 1.

### Step 0 (near-free, trade domain only, do this first regardless of anything else)
Wire `runWeeklyRecalibration()` into the existing weekly cadence already assumed by its own naming and its `daysSinceRecal < 6.5` guard — e.g., call it from `runBackgroundTradeAnalysis()` alongside (or instead of) `runFullCalibration()`, or give it its own cron entry. This activates a mechanism that was already engineered correctly and is sitting idle. Separately, and independently: either delete `calibrateInterceptFromOutcomes()`'s and `drift-detection.ts`'s hardcoded `OBSERVED_ACCEPT_RATE = 0.85` and wire them to real `TradeOutcomeEvent` aggregates (the same query `computeShadowB0()` already performs), or remove those functions in favor of the shadow-B0 path so there is exactly one source of truth instead of two disagreeing ones.

### Step 1 — Decision Outcome schema (net-new, Decision OS scope)
Extend the four existing but empty outcome-hook files (`lib/decision-os/{lineup,waiver,trade,commissioner-health}/outcome.ts`) with a real, additive schema: a `DecisionOutcome` table keyed by `decisionId` (the `Decision<TAction>` object already has an identity — confirm/mint one if not), `wasFollowed` (boolean), `outcomeMeasuredAt`, and a slice-specific outcome payload (e.g., lineup: actual points scored by started vs. best-possible bench player; waiver: added player's points over the following N weeks vs. replacement level; trade: realized value differential N weeks later). This is squarely additive per `ARCHITECTURE_FREEZE.md` — no existing contract shape changes.

### Step 2 — Matchup prediction-accuracy bridge (highest-value net-new signal, zero domain modeling needed)
Persist `MatchupPredictionEngine`'s `winProbabilityA/B` (currently ephemeral) at prediction time, keyed to the same `matchupId` that `MatchupFact` later fills with the real score. This is the cheapest true prediction-vs-outcome signal available on the entire platform — it requires no new domain logic, only persisting a value that is already computed and thrown away.

### Step 3 — Recommendation-to-outcome linkage
Make `AiRecommendationOutcome.recommendationId` actually get populated: at minimum, wire trade/waiver/lineup recommendation-emission points to write a row, and wire the corresponding action (accept/execute/ignore) to call `resolveRecommendationOutcome()`. The schema already supports this; today nothing calls it outside admin tooling.

### Step 4 — Learning Engine v1 proper (Decision OS-native, after Steps 1–3 produce real data)
A single, canonical service (not a fourth parallel system) that:
- Reads `DecisionOutcome` rows per slice.
- Computes calibration drift the way `drift-detection.ts` already knows how to (reuse the statistical design, not the code, and point it at real data only).
- Adjusts `Decision.confidence`/`DecisionOSInsight.confidence` computation with a maturity-gated, sample-size-gated, divergence-capped promotion — i.e., re-apply the shadow-B0 pattern from `auto-recalibration.ts`, which is already a proven, safe design in this codebase, to Decision OS's own confidence values instead of only the legacy trade engine's.
- This needs its own ADR before touching any frozen Phase 6 confidence computation, per `ARCHITECTURE_FREEZE.md` — consistent with the governance rule already applied to the `conservative_roster_pattern` fix.

### Rollout / production safety
- Every step above is additive; none requires modifying a frozen contract shape.
- Step 0 touches only the legacy trade engine, which is explicitly out of Decision OS's frozen-component list — safest possible first move, and the highest ratio of value to risk in this entire roadmap.
- Steps 1–3 are new tables/columns and new write-points into existing flows (mirroring the Phase 2H `RedraftRosterMoveHistory` precedent: hand-authored migration, wrapped in its own try/catch so a learning-write failure can never fail the underlying user action).
- Step 4 is the only step that touches frozen Decision OS confidence computation and is the only one that requires an ADR before implementation.

---

## Files changed in this session

- `docs/DECISION_OS_CLOSED_LOOP_LEARNING_AUDIT.md` (this document, new)

No other file was created, modified, or deleted. No database was queried or connected to. Not committed — per this task's instructions, commit only if explicitly requested.
