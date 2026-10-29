/**
 * Executes accepted redraft trades whose review window ended with no veto (./tradeReviewWindow.ts).
 * Hourly, from `/api/redraft/waiver-process` beside the offer-expiry sweep.
 *
 * Through the same finalizer every other path uses (./finalizeRedraftTrade.ts), so the claim on
 * `status = 'pending'` decides a race with a commissioner approving or a vote landing at the same instant:
 * one of them settles the trade, the other finds it resolved.
 *
 *   moves locked            left pending and retried next hour: the lock binds at settlement for every
 *                           path (lib/redraft/tradeMoveLock.ts), and lifting it should let the trade through
 *   settlement refused      the trade can never settle as agreed (a player is gone, the cap no longer
 *                           fits), so it is closed as `expired` with the reason, rather than retried forever
 */
import { prisma } from '@/lib/prisma'
import { isRedraftLeagueMovesLocked } from '@/lib/redraft/tradeMoveLock'
import { finalizeRedraftTrade, upsertRedraftTradeDecision } from '@/lib/redraft/finalizeRedraftTrade'
import { recordRedraftTradeMarketEvent } from '@/lib/trade-market/redraftTradeMarketEvents'
import { queueTradeStatusInDm } from '@/lib/chat-notifications/tradeOfferDm'
import { heldTradeIds } from '@/lib/integrity/holdFlaggedTrades'

/**
 * Per run. A settlement costs far more than an expiry, and the host cron has a 60s budget with its own
 * waiver work to do; a backlog drains over the following hours, oldest window first.
 */
export const DEFAULT_TRADE_REVIEW_LIMIT = 10
export const REVIEW_WINDOW_DECISION_REASON = 'Review window ended with no veto'

export type TradeReviewSweepResult = {
  due: number
  processed: number
  /** Left for next hour: the commissioner has frozen moves. */
  waitingOnLock: number
  /** Flagged by the integrity check in a league that holds flagged trades (lib/integrity/holdFlaggedTrades.ts). */
  held: number
  /** Settled or decided by someone else between the read and the claim. */
  skipped: number
  /** Could not settle as agreed and were closed. */
  closed: number
  failures: { proposalId: string; error: string }[]
}

export async function processDueTradeReviews(opts?: { limit?: number; now?: Date }): Promise<TradeReviewSweepResult> {
  const now = opts?.now ?? new Date()
  const limit = Math.max(1, Math.min(opts?.limit ?? DEFAULT_TRADE_REVIEW_LIMIT, 200))
  // Flagged trades in leagues that hold them wait for the commissioner, not the clock — left out of
  // the read, so they cannot occupy the batch and starve every other due trade.
  const held = await heldTradeIds()
  const dueWhere = { status: 'pending', acceptedAt: { not: null }, expiresAt: { lt: now }, vetoMode: { in: ['commissioner', 'league_vote'] } }
  const heldDue = held.length ? await prisma.redraftTradeProposal.count({ where: { ...dueWhere, id: { in: held } } }) : 0
  const due = await prisma.redraftTradeProposal.findMany({
    where: { ...dueWhere, ...(held.length ? { id: { notIn: held } } : {}) },
    orderBy: { expiresAt: 'asc' },
    take: limit,
    include: { assets: true },
  })
  const result: TradeReviewSweepResult = { due: due.length, processed: 0, waitingOnLock: 0, held: heldDue, skipped: 0, closed: 0, failures: [] }
  const locked = new Map<string, boolean>()

  for (const proposal of due) {
    try {
      if (!locked.has(proposal.leagueId)) locked.set(proposal.leagueId, await isRedraftLeagueMovesLocked(proposal.leagueId))
      if (locked.get(proposal.leagueId)) {
        result.waitingOnLock += 1
        continue
      }
      const owners = await prisma.redraftRoster.findMany({
        where: { id: { in: [proposal.proposerRosterId, proposal.receiverRosterId] } },
        select: { id: true, ownerId: true },
      })
      const ownerOf = (id: string) => owners.find((o) => o.id === id)?.ownerId ?? undefined
      const settled = await finalizeRedraftTrade(
        proposal,
        ownerOf(proposal.proposerRosterId),
        ownerOf(proposal.receiverRosterId),
        null,
        REVIEW_WINDOW_DECISION_REASON,
        'proposal_accepted',
        'review_window',
      )
      if (settled.ok) {
        result.processed += 1
        continue
      }
      if (settled.alreadyResolved) {
        result.skipped += 1
        continue
      }
      // Agreed, unvetoed, and still impossible to settle: close it with the reason instead of retrying hourly.
      const closed = await prisma.redraftTradeProposal.updateMany({
        where: { id: proposal.id, status: 'pending' },
        data: { status: 'expired', processedAt: now },
      })
      if (closed.count === 0) {
        result.skipped += 1
        continue
      }
      const reason = `Could not be processed when the review window ended: ${settled.error}`
      await upsertRedraftTradeDecision(proposal.id, 'expired', null, reason)
      await recordRedraftTradeMarketEvent({
        leagueId: proposal.leagueId,
        seasonId: proposal.seasonId,
        tradeProposalId: proposal.id,
        eventType: 'proposal_expired',
        actorUserId: null,
      })
      queueTradeStatusInDm({ source: 'redraft', tradeId: proposal.id, status: 'expired', detail: reason })
      result.closed += 1
    } catch (e) {
      result.failures.push({ proposalId: proposal.id, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}
