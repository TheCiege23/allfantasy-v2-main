/**
 * Commissioner Intelligence Platform — Phase 4: Trade Review resolver.
 *
 * Live, READ-ONLY provider. Resolves the league's latest redraft season, reads
 * the `IntelligenceLeagueSnapshot` trade counts + the pending / recently-actioned
 * `RedraftTradeProposal` rows (with a deterministic vote `_count`), and runs the
 * pure `aggregateCommissionerTradeReview`.
 *
 * Read-only: at most three findFirst/findMany reads, zero writes. Consumes NO
 * AI/recommendation source — never `TradeAnalysisSnapshot`, `GuardianIntervention`,
 * the proposal's `valueSnapshot`/`decision`, or any fairness/collusion/veto engine.
 * The CALLER (route) enforces commissioner auth; this provider takes a leagueId.
 */

import { prisma } from '@/lib/prisma'
import { aggregateCommissionerTradeReview } from './tradeReviewAggregator'
import type { CommissionerTradeReviewV1, TradeReviewProposalInput } from './types'

// Pending-ish statuses to always include (the aggregator re-classifies precisely).
const PENDING_STATUS_LIST = ['pending', 'proposed', 'open', 'awaiting_review', 'review', 'voting']
// Fetch a slightly wider window than the aggregator's 14-day "recent" so recently
// actioned proposals are always present for it to classify.
const FETCH_WINDOW_DAYS = 30

export interface TradeReviewResolverArgs {
  leagueId: string
}

export interface TradeReviewDataProvider {
  /** Returns the contract, or null when the league has no redraft season. */
  getCommissionerTradeReview(args: TradeReviewResolverArgs): Promise<CommissionerTradeReviewV1 | null>
}

export function createLiveTradeReviewDataProvider(): TradeReviewDataProvider {
  return {
    async getCommissionerTradeReview({ leagueId }) {
      const season = await prisma.redraftSeason.findFirst({
        where: { leagueId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
      if (!season) return null

      const cutoff = new Date(Date.now() - FETCH_WINDOW_DAYS * 24 * 60 * 60 * 1000)

      const [snapshotRow, proposalRows] = await Promise.all([
        prisma.intelligenceLeagueSnapshot.findUnique({
          where: { leagueId },
          select: { openTradeProposals: true, tradeCount: true, lastTradeAt: true },
        }),
        prisma.redraftTradeProposal.findMany({
          where: {
            seasonId: season.id,
            OR: [{ status: { in: PENDING_STATUS_LIST } }, { updatedAt: { gte: cutoff } }],
          },
          select: {
            status: true,
            expiresAt: true,
            acceptedAt: true,
            rejectedAt: true,
            cancelledAt: true,
            createdAt: true,
            _count: { select: { votes: true } },
          },
          take: 500,
        }),
      ])

      const proposals: TradeReviewProposalInput[] = proposalRows.map((p) => ({
        status: p.status,
        expiresAt: p.expiresAt,
        acceptedAt: p.acceptedAt,
        rejectedAt: p.rejectedAt,
        cancelledAt: p.cancelledAt,
        createdAt: p.createdAt,
        voteCount: p._count.votes,
      }))

      return aggregateCommissionerTradeReview({
        snapshot: snapshotRow
          ? {
              openTradeProposals: snapshotRow.openTradeProposals,
              tradeCount: snapshotRow.tradeCount,
              lastTradeAt: snapshotRow.lastTradeAt ? snapshotRow.lastTradeAt.toISOString() : null,
            }
          : null,
        proposals,
      })
    },
  }
}
