/**
 * Commissioner Intelligence Platform — Phase 4: Trade Review display contract.
 *
 * `CommissionerTradeReviewV1` answers "what trade-review WORKLOAD exists in this
 * league right now?" — DETERMINISTIC, OBSERVATIONAL only. It never answers "who
 * won", "should this be vetoed", "is this collusion", or "is someone cheating".
 * The field is `reviewWorkload` (NOT `fairnessSignal`) on purpose: it describes
 * review load/state, never a fairness verdict.
 *
 * ── Canonical-source decision (Phase 4, first required step) ─────────────────
 * Phase 3's audit found multiple trade models. This module uses:
 *   • SUMMARY COUNTS  → `IntelligenceLeagueSnapshot` (openTradeProposals /
 *     tradeCount / lastTradeAt) — already projected deterministically from
 *     `transaction.trade.*` DomainEvents; keeps the pending count CONSISTENT with
 *     the hub's Activity module.
 *   • REVIEW-WINDOW / VOTE DETAIL → `RedraftTradeProposal` (+ its `votes`
 *     relation = `RedraftTradeVote`). Chosen over RedraftLeagueTrade / AfLeagueTrade
 *     because it is the production-current redraft trade model (most writes), it
 *     is the model votes attach to, and it carries the review-window fields
 *     (`status`, `expiresAt`, `acceptedAt`/`rejectedAt`/`cancelledAt`).
 * DELIBERATELY NOT USED: `TradeAnalysisSnapshot`, `GuardianIntervention`,
 * `RedraftTradeProposal.valueSnapshot`/`decision` (AI value/verdict), and every
 * fairness/collusion/tanking/veto-likelihood engine (all AI/recommendation/
 * accusation — see docs/COMMISSIONER_TRADE_REVIEW_FAIRNESS_AUDIT.md).
 */

export const COMMISSIONER_TRADE_REVIEW_VERSION = 'commissioner-trade-review.v1'

export type TradeActivity = 'quiet' | 'normal' | 'active' | 'unknown'
/** Review LOAD/STATE — never a fairness/veto/collusion verdict. */
export type ReviewWorkload = 'none' | 'watch' | 'requires_review' | 'unknown'

export interface CommissionerTradeReviewV1 {
  version: typeof COMMISSIONER_TRADE_REVIEW_VERSION
  derivedAt: string

  pendingTradeCount: number
  recentTradeCount: number
  reviewWindowCount: number
  voteCount: number

  tradeActivity: TradeActivity
  reviewWorkload: ReviewWorkload

  summary: string
  caveats: string[]
}

// ── pure aggregator inputs (Prisma-decoupled) ────────────────────────────────

export interface TradeReviewSnapshotInput {
  openTradeProposals: number | null
  tradeCount: number | null
  lastTradeAt: string | null
}

export interface TradeReviewProposalInput {
  status: string | null | undefined
  /** review window: pending + expiresAt in the future = an open window. */
  expiresAt?: string | Date | null
  acceptedAt?: string | Date | null
  rejectedAt?: string | Date | null
  cancelledAt?: string | Date | null
  createdAt?: string | Date | null
  /** deterministic tally of RedraftTradeVote rows for this proposal. */
  voteCount: number
}

export interface TradeReviewAggregationInput {
  /** IntelligenceLeagueSnapshot fields; null when no snapshot row exists yet. */
  snapshot: TradeReviewSnapshotInput | null
  /** Pending + recently-actioned RedraftTradeProposal rows for the season. */
  proposals: TradeReviewProposalInput[]
}
