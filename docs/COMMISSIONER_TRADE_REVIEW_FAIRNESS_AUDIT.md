# Commissioner Trade Review / Fairness — Data Audit (Phase 3)

**Purpose:** determine whether AllFantasy has clean **deterministic** data sources for a
Commissioner-facing Trade Review / Fairness display module — **without** consuming recommendation
endpoints or AI-generated advice. **Audit only:** no module, no contract, no code changes, no DB
access.

**Date:** 2026-07-07 · **Branch:** `g15-event-foundation`

## Verdict: **GO** (with a fairness guardrail)

Clean deterministic trade data **exists** and a display-safe Commissioner Trade Review module is
buildable. **BUT** the `fairnessSignal` must be redefined as a **review-workload / review-window
state** signal (evidence-based, non-accusatory) — it must **never** be sourced from the AI
fairness / collusion / tanking / veto-likelihood engines. With that guardrail, GO for Phase 4.

---

## 1. What deterministic trade data exists (SAFE)

| Source | Kind | Deterministic fields | Classification |
| --- | --- | --- | --- |
| `RedraftLeagueTrade` | model | `status` (pending/complete/cancelled…), `proposerId`/`receiverId` (+rosterIds), `proposerOffers`/`receiverOffers` (Json asset lists → **counts** safe), `expiresAt`, timestamps | **display-safe** (counts/status/timestamps; do NOT render raw asset IDs) |
| `RedraftTradeVote` | model | `proposalId`, `vote`, `createdAt`, index `[proposalId, vote]` | **display-safe** (deterministic vote tallies → veto/review-window state) |
| `TradeOfferEvent` / `TradeOutcomeEvent` | models | offer/outcome event log | **display-safe** (event data) |
| `AfLeagueTrade` + `AfLeagueTradeItem` + `AfLeagueTradeStatusHistory` | models | canonical AF trade + items + **status history** | **display-safe** |
| **Intelligence snapshot (already projected!)** | `IntelligenceLeagueSnapshot` | `openTradeProposals`, `tradeCount`, `lastTradeAt` — from deterministic `transaction.trade.{proposed,accepted,rejected,canceled,vetoed}` DomainEvents (`snapshotProjection.ts` `tradeProposalDelta`) | **display-safe** — the Commissioner Activity module already surfaces `openTradeProposals`; Action Items already emits `pending_trades` |

**Big finding:** the core counts a Trade Review module needs (`pendingTradeCount`, recent activity,
`lastTradeAt`) are **already deterministically projected** into `IntelligenceLeagueSnapshot`. A
Phase 4 resolver can largely **reuse the existing snapshot** + light `RedraftLeagueTrade` /
`RedraftTradeVote` reads — not a heavy new aggregation.

Deterministic status vocabulary: `pending`, `complete`/`completed`, `cancelled`, plus event-level
`accepted` / `rejected` / `canceled` / `vetoed`, plus `expired` (derivable from `expiresAt`).

---

## 2. What fairness data exists (UNSAFE for direct display)

| Source | Why unsafe |
| --- | --- |
| `lib/ai-commissioner/TradeFairnessAnalyzer.ts` | **AI-generated** fairness verdict ("who won") — recommendation-adjacent |
| `TradeAnalysisSnapshot` (model = opaque `payloadJson`; written by `lib/trade-engine/snapshot-store.ts`) | **cached AI/engine analysis** blob — recommendation-adjacent |
| `GuardianIntervention` (`lib/analytics/decision-guardian.ts`) | stores **`aiRecommendation`**, `deviationScore`, `confidenceScore` — explicitly AI/recommendation |
| `lib/integrity/CollusionDetectionEngine.ts`, `CollusionSignalDetector.ts`, `zombie/ZombieCollusionFlagService.ts` | **collusion = an accusation**; unsafe to surface to a commissioner without due-process framing (spec forbids "collusion accusation without evidence") |
| `lib/integrity/TankingDetectionEngine.ts` | **tanking = an accusation**; same sensitivity |
| `lib/big-brother/BigBrotherVetoEngine.ts`, `lib/trade-engine/vetoLikelihood.ts`, `lib/trade-veto.ts` | **veto PREDICTION** ("likely to be vetoed") — recommendation-adjacent |
| `TradeLearningInsight` / `TradeLearningStats` / `TradeOutcomeTraining` | **Trade Learning / calibration** — off-limits + internal-only |
| `enhanced-fairness.ts`, `legacy-tool/fairness.ts`, `survivor/ai/fairnessAudit.ts` | fairness scoring — recommendation-adjacent ("who won") |

**None of these may feed the Trade Review module.**

---

## 3. Routes audit

**Safe / deterministic (read):**
- `GET /api/leagues/[leagueId]/trades` + `…/trades/[tradeId]` — list/detail of trades (session-authed).
- `…/draft/trade-proposals` + `…/[proposalId]` + `…/[proposalId]/review` — proposal + review state.

**Commissioner-facing but niche:** `GET /api/commissioner/leagues/[id]/idp/trade-warnings`
(session + `assertCommissioner`, IDP salary/cap-specific — deterministic but narrow).

**UNSAFE / off-limits (AI / recommendation):**
- `…/trades/analyze-ai`, `…/trade/ai-decision`, `…/draft/trade-builder/{analyze,suggestions}`.

> The Commissioner hub today calls **none** of the unsafe routes — this is already regression-
> guarded by `__tests__/commissioner-intelligence/proof-surface.test.tsx` (route allowlist +
> no-AI-endpoint assertions). Phase 4 must keep it that way.

---

## 4. Recommended module shape (Phase 4, do NOT build yet)

The proposed `CommissionerTradeReviewV1` is sound, with **one required change**: `fairnessSignal`
is a **review-workload/window** signal, not a fairness verdict.

```ts
interface CommissionerTradeReviewV1 {
  version: 'commissioner-trade-review.v1'
  derivedAt: string
  pendingTradeCount: number      // open proposals (snapshot.openTradeProposals / RedraftLeagueTrade status=pending)
  recentTradeCount: number       // completed/actioned in a recent window (tradeCount delta / status history)
  reviewWindowCount: number      // trades currently inside a review/veto window (RedraftTradeVote activity + expiresAt)
  tradeActivity: 'quiet' | 'normal' | 'active' | 'unknown'   // deterministic thresholds on recent volume
  fairnessSignal: 'none' | 'watch' | 'requires_review' | 'unknown'
  summary: string                // "3 trades are pending review. Trade activity is elevated this week."
  caveats: string[]
}
```

**`fairnessSignal` derivation (deterministic, evidence-based, NON-accusatory):**
- `requires_review` = one or more trades are in an **open review/veto window** (pending + within
  `expiresAt` + has `RedraftTradeVote` activity) — a *state*, not a judgment.
- `watch` = elevated pending volume vs a threshold.
- `none` = nothing pending. `unknown` = no data.
- It must **never** mean "this trade is unfair," "who won," collusion, or tanking. If a clean
  deterministic review-window source proves insufficient, ship `fairnessSignal: 'none'|'unknown'`
  in v1 and defer it — do not reach for the AI/collusion engines.

Allowed copy: *"3 trades are pending review."* / *"Trade activity is elevated this week."*
Forbidden copy: *"Veto this trade."* / *"Manager A is cheating."* / *"Accept this offer."* /
any collusion/tanking accusation.

---

## 5. Known blockers

1. **Same event-dependency as the rest of the Commissioner hub:** counts come from projected
   `DomainEvent`s → **import-only Sleeper leagues render ~empty** until native trade activity
   exists (see [snapshot seed runbook](./COMMISSIONER_INTELLIGENCE_SNAPSHOT_SEED_RUNBOOK.md)).
2. **Review-window modeling:** confirm in Phase 4 exactly how a "review/veto window" is
   represented (status value vs `expiresAt` vs `RedraftTradeVote` presence) — a short focused
   check, since multiple trade models exist (`RedraftLeagueTrade` vs `RedraftTradeProposal` vs
   `AfLeagueTrade`). Pick ONE canonical source for the resolver.
3. **Asset JSON:** `proposerOffers`/`receiverOffers` are Json and may contain player IDs — expose
   **counts only**, never raw asset payloads.

---

## 6. Recommended Phase 4 build plan (if approved)

**Commissioner Trade Review Display Contract** — same proven pattern:
`display-safe contract → deterministic aggregation → read-only resolver → default-off internal
route → Commissioner hub module`.

1. `lib/intelligence/trade-review/` (or `lib/decision-os/...`) — `types.ts` (`CommissionerTradeReviewV1`),
   pure `tradeReviewAggregator.ts` (counts + activity/`fairnessSignal` tiers, documented thresholds),
   read-only `tradeReviewResolver.ts` (reuse `IntelligenceLeagueSnapshot` + light
   `RedraftLeagueTrade`/`RedraftTradeVote` reads).
2. Internal A1 route `GET /api/v1/intelligence/leagues/[id]/trade-review` (or the app route family),
   commissioner-gated (`requireCommissioner`), default-off flag
   `COMMISSIONER_TRADE_REVIEW_ENABLED`.
3. New `TradeReviewModule` in the Commissioner hub (its own loading/empty/restricted/upgrade states).
4. Aggregator unit tests (deterministic tiers, `fairnessSignal` never accusatory, banned-language
   scan) + route tests (gate/401/403/data/empty) + keep the route-allowlist regression green.

**Do NOT** consume any Section-2 source. Confirm blocker #2 (canonical review-window source) before
building.
