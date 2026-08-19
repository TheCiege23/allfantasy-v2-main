/**
 * Commissioner Intelligence Platform — Phase 4: Trade Review aggregator test.
 *
 * Pure, deterministic aggregation + contract tests. No DB, no mocks. Covers the
 * spec's required cases (empty trade state, pending trades, active review window,
 * recent trade activity, unknown/missing source) plus the documented thresholds,
 * determinism, and — critically — that NO fairness/veto/collusion verdict or raw
 * ID leaks into the summary/caveats.
 */
import { describe, it, expect } from 'vitest'
import { aggregateCommissionerTradeReview } from '@/lib/decision-os/commissioner-intelligence/trade-review/tradeReviewAggregator'
import {
  COMMISSIONER_TRADE_REVIEW_VERSION,
  type TradeReviewProposalInput,
  type TradeReviewSnapshotInput,
} from '@/lib/decision-os/commissioner-intelligence/trade-review/types'

const NOW = new Date('2026-11-15T00:00:00.000Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()
const daysAhead = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString()

function prop(over: Partial<TradeReviewProposalInput> = {}): TradeReviewProposalInput {
  return { status: 'pending', expiresAt: null, acceptedAt: null, rejectedAt: null, cancelledAt: null, createdAt: daysAgo(1), voteCount: 0, ...over }
}
function snap(over: Partial<TradeReviewSnapshotInput> = {}): TradeReviewSnapshotInput {
  return { openTradeProposals: 0, tradeCount: 0, lastTradeAt: null, ...over }
}

// Language that would imply a fairness/veto/collusion verdict — must never appear.
const BANNED = /\b(veto|unfair|collusion|cheat|cheating|recommend)\b|won the trade|accept this|reject this|should be vetoed/i

describe('aggregateCommissionerTradeReview — empty / unknown source', () => {
  it('no snapshot AND no proposals → honest unknown (import-only-league blocker)', () => {
    const r = aggregateCommissionerTradeReview({ snapshot: null, proposals: [] }, NOW)!
    expect(r.tradeActivity).toBe('unknown')
    expect(r.reviewWorkload).toBe('unknown')
    expect(r.pendingTradeCount).toBe(0)
    expect(r.caveats.some((c) => /no trade data is available/i.test(c))).toBe(true)
  })

  it('snapshot present but zero trades → quiet / none (not unknown)', () => {
    const r = aggregateCommissionerTradeReview({ snapshot: snap(), proposals: [] }, NOW)!
    expect(r.tradeActivity).toBe('quiet')
    expect(r.reviewWorkload).toBe('none')
    expect(r.summary).toMatch(/no trades are pending review/i)
  })
})

describe('aggregateCommissionerTradeReview — pending + review window', () => {
  it('pending count prefers the intelligence snapshot; workload = watch', () => {
    const r = aggregateCommissionerTradeReview({ snapshot: snap({ openTradeProposals: 3 }), proposals: [prop(), prop()] }, NOW)!
    expect(r.pendingTradeCount).toBe(3) // from snapshot, not the 2 proposals
    expect(r.reviewWorkload).toBe('watch')
    expect(r.summary).toMatch(/3 trades are currently pending review/i)
  })

  it('open review window (future expiry OR active votes) → requires_review', () => {
    const r = aggregateCommissionerTradeReview(
      { snapshot: snap({ openTradeProposals: 2 }), proposals: [prop({ expiresAt: daysAhead(2) }), prop({ voteCount: 3 })] },
      NOW,
    )!
    expect(r.reviewWindowCount).toBe(2)
    expect(r.voteCount).toBe(3)
    expect(r.reviewWorkload).toBe('requires_review')
    expect(r.summary).toMatch(/open review window/i)
  })

  it('a pending proposal with only a past expiry and no votes is NOT an open window', () => {
    const r = aggregateCommissionerTradeReview({ snapshot: snap({ openTradeProposals: 1 }), proposals: [prop({ expiresAt: daysAgo(1) })] }, NOW)!
    expect(r.reviewWindowCount).toBe(0)
    expect(r.reviewWorkload).toBe('watch')
  })
})

describe('aggregateCommissionerTradeReview — recent activity tiers', () => {
  it('quiet (0) / normal (1–3) / active (>=4) by recent terminal actions in 14 days', () => {
    const accepted = (n: number) => Array.from({ length: n }, () => prop({ status: 'accepted', acceptedAt: daysAgo(3) }))
    expect(aggregateCommissionerTradeReview({ snapshot: snap(), proposals: [] }, NOW)!.tradeActivity).toBe('quiet')
    expect(aggregateCommissionerTradeReview({ snapshot: snap(), proposals: accepted(2) }, NOW)!.tradeActivity).toBe('normal')
    expect(aggregateCommissionerTradeReview({ snapshot: snap(), proposals: accepted(4) }, NOW)!.tradeActivity).toBe('active')
  })

  it('only counts terminal actions within the recent window', () => {
    const r = aggregateCommissionerTradeReview(
      { snapshot: snap(), proposals: [prop({ status: 'accepted', acceptedAt: daysAgo(3) }), prop({ status: 'rejected', rejectedAt: daysAgo(20) })] },
      NOW,
    )!
    expect(r.recentTradeCount).toBe(1) // the 20-days-ago one is outside the window
  })
})

describe('aggregateCommissionerTradeReview — provenance, determinism, safety', () => {
  it('emits the full V1 contract; caveats note a missing snapshot', () => {
    const r = aggregateCommissionerTradeReview({ snapshot: null, proposals: [prop()] }, NOW)!
    expect(r.version).toBe(COMMISSIONER_TRADE_REVIEW_VERSION)
    expect(r.derivedAt).toBe(NOW.toISOString())
    expect(r.pendingTradeCount).toBe(1) // from proposals (no snapshot)
    expect(r.caveats.some((c) => /intelligence snapshot isn't available/i.test(c))).toBe(true)
    expect(Object.keys(r).sort()).toEqual(
      ['caveats', 'derivedAt', 'pendingTradeCount', 'recentTradeCount', 'reviewWindowCount', 'reviewWorkload', 'summary', 'tradeActivity', 'version', 'voteCount'].sort(),
    )
  })

  it('is deterministic — identical input yields identical output', () => {
    const input = { snapshot: snap({ openTradeProposals: 2 }), proposals: [prop({ expiresAt: daysAhead(1) }), prop({ status: 'accepted', acceptedAt: daysAgo(2) })] }
    expect(aggregateCommissionerTradeReview(input, NOW)).toEqual(aggregateCommissionerTradeReview(input, NOW))
  })

  it('summary + caveats carry NO fairness/veto/collusion verdict language (all scenarios)', () => {
    const scenarios = [
      { snapshot: null, proposals: [] },
      { snapshot: snap({ openTradeProposals: 3 }), proposals: [prop({ expiresAt: daysAhead(2), voteCount: 2 }), prop()] },
      { snapshot: snap({ openTradeProposals: 0 }), proposals: [prop({ status: 'accepted', acceptedAt: daysAgo(1) })] },
    ]
    for (const s of scenarios) {
      const r = aggregateCommissionerTradeReview(s, NOW)!
      expect(BANNED.test(r.summary)).toBe(false)
      expect(BANNED.test(r.caveats.join(' '))).toBe(false)
      // no raw IDs in the human-facing strings
      expect(/\b[0-9a-f]{8,}\b/i.test(r.summary + ' ' + r.caveats.join(' '))).toBe(false)
    }
  })
})
