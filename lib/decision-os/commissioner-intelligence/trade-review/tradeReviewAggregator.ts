/**
 * Commissioner Intelligence Platform — Phase 4: Trade Review aggregator.
 *
 * Pure, deterministic. Given the league's intelligence snapshot trade counts +
 * its pending/recent `RedraftTradeProposal` rows, it returns the display-only
 * `CommissionerTradeReviewV1`. No I/O, no Prisma, no LLM, no fairness/veto/
 * collusion judgment — only review WORKLOAD facts. Missing data is reported
 * honestly as `'unknown'` (ties to the import-only-league blocker), never faked.
 */

import {
  COMMISSIONER_TRADE_REVIEW_VERSION,
  type CommissionerTradeReviewV1,
  type ReviewWorkload,
  type TradeActivity,
  type TradeReviewAggregationInput,
  type TradeReviewProposalInput,
} from './types'

// ── thresholds (documented + tested) ─────────────────────────────────────────
const RECENT_WINDOW_DAYS = 14
const ACTIVE_MIN = 4 // recentTradeCount >= 4 → active
const NORMAL_MIN = 1 // recentTradeCount >= 1 → normal

// Statuses that mean "still open / awaiting resolution" (case-insensitive).
const PENDING_STATUSES = new Set(['pending', 'proposed', 'open', 'awaiting_review', 'review', 'voting'])

function normalize(status: string | null | undefined): string {
  return String(status ?? '').trim().toLowerCase()
}
function isPending(status: string | null | undefined): boolean {
  return PENDING_STATUSES.has(normalize(status))
}
function toTime(v: string | Date | null | undefined): number | null {
  if (v == null) return null
  const t = v instanceof Date ? v.getTime() : Date.parse(v)
  return Number.isFinite(t) ? t : null
}
/** A terminal action timestamp (accepted/rejected/cancelled), whichever is set. */
function terminalTime(p: TradeReviewProposalInput): number | null {
  return toTime(p.acceptedAt) ?? toTime(p.rejectedAt) ?? toTime(p.cancelledAt)
}

function classifyActivity(recentTradeCount: number): TradeActivity {
  if (recentTradeCount >= ACTIVE_MIN) return 'active'
  if (recentTradeCount >= NORMAL_MIN) return 'normal'
  return 'quiet'
}
function classifyWorkload(pendingTradeCount: number, reviewWindowCount: number): ReviewWorkload {
  if (reviewWindowCount > 0) return 'requires_review'
  if (pendingTradeCount > 0) return 'watch'
  return 'none'
}

// ── summary (observational, no verdicts) ─────────────────────────────────────
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}
function activityPhrase(a: TradeActivity): string {
  if (a === 'active') return 'Trade activity has been active recently.'
  if (a === 'normal') return 'Trade activity has been steady recently.'
  if (a === 'quiet') return 'Trade activity has been quiet recently.'
  return ''
}

/**
 * Aggregate into the display-only Trade Review contract. Returns `null` only when
 * the caller passes no context at all (defensive) — the resolver returns null for
 * "no season" so the hub shows an empty state.
 */
export function aggregateCommissionerTradeReview(
  input: TradeReviewAggregationInput,
  now: Date = new Date(),
): CommissionerTradeReviewV1 | null {
  if (!input) return null

  const snapshot = input.snapshot
  const proposals = input.proposals ?? []
  const nowMs = now.getTime()
  const recentCutoff = nowMs - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000

  // No snapshot AND no proposals → we genuinely have no trade signal for this
  // league (e.g. an import-only league with no native trade activity). Say so.
  const noData = snapshot == null && proposals.length === 0

  const pendingProposals = proposals.filter((p) => isPending(p.status))
  // Prefer the intelligence snapshot's open count (consistent with the Activity
  // module); fall back to the direct pending-proposal count.
  const pendingTradeCount = snapshot?.openTradeProposals != null ? snapshot.openTradeProposals : pendingProposals.length

  // Recent = proposals that reached a terminal action within the recent window.
  const recentTradeCount = proposals.filter((p) => {
    const t = terminalTime(p)
    return t != null && t >= recentCutoff && t <= nowMs
  }).length

  // Open review window = pending proposal with a future expiry OR active votes.
  const reviewWindowCount = pendingProposals.filter((p) => {
    const exp = toTime(p.expiresAt)
    return (exp != null && exp > nowMs) || p.voteCount > 0
  }).length

  const voteCount = pendingProposals.reduce((sum, p) => sum + Math.max(0, p.voteCount), 0)

  const tradeActivity: TradeActivity = noData ? 'unknown' : classifyActivity(recentTradeCount)
  const reviewWorkload: ReviewWorkload = noData ? 'unknown' : classifyWorkload(pendingTradeCount, reviewWindowCount)

  const caveats: string[] = []
  if (noData) {
    caveats.push('No trade data is available for this league yet — it may have no recorded native trade activity.')
  } else if (snapshot == null) {
    caveats.push("Counts are derived from trade records; the league's intelligence snapshot isn't available yet.")
  }

  const summary = buildSummary({ noData, pendingTradeCount, reviewWindowCount, tradeActivity })

  return {
    version: COMMISSIONER_TRADE_REVIEW_VERSION,
    derivedAt: now.toISOString(),
    pendingTradeCount,
    recentTradeCount,
    reviewWindowCount,
    voteCount,
    tradeActivity,
    reviewWorkload,
    summary,
    caveats,
  }
}

function buildSummary(c: {
  noData: boolean
  pendingTradeCount: number
  reviewWindowCount: number
  tradeActivity: TradeActivity
}): string {
  if (c.noData) return 'No trade data is available for this league yet.'
  const parts: string[] = []
  parts.push(
    c.pendingTradeCount > 0
      ? `${plural(c.pendingTradeCount, 'trade')} ${c.pendingTradeCount === 1 ? 'is' : 'are'} currently pending review.`
      : 'No trades are pending review.',
  )
  if (c.reviewWindowCount > 0) {
    parts.push(`There ${c.reviewWindowCount === 1 ? 'is' : 'are'} ${plural(c.reviewWindowCount, 'open review window')}.`)
  }
  const activity = activityPhrase(c.tradeActivity)
  if (activity) parts.push(activity)
  return parts.join(' ')
}
