import 'server-only'

/**
 * The hourly run for "trades don't wait forever" (./tradeReviewAutoApprove.ts): every league trade
 * waiting on commissioner review in a league that switched it on. Each approval is claimed once (a
 * `sportsDataCache` row keyed on the trade), then processed by `finalizeAfLeagueTradeProcessing` — the
 * commissioner Approve path, with its roster, lifecycle and processing-delay rules — and recorded as
 * automatic in the trade's status history and the league audit log.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logAction } from '@/server/services/auditService'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { finalizeAfLeagueTradeProcessing } from './tradeService'
import { AUTO_APPROVE_HOURS, TRADE_REVIEW_AUTO_APPROVE_KEY, WARN_HOURS, autoApproveDecision } from './tradeReviewAutoApprove'

export const TRADE_AUTO_APPROVED_ACTION = 'trade_review.auto_approved'
const CLAIM_PREFIX = 'af-trade-auto-approve:'
const HOUR_MS = 3_600_000

export type TradeAutoApproveRunResult = { waiting: number; warned: number; approved: number; flagged: number; failures: { tradeId: string; error: string }[] }

export async function runTradeReviewAutoApprovals(opts?: { now?: Date; limit?: number; deadline?: number }): Promise<TradeAutoApproveRunResult> {
  const now = opts?.now ?? new Date()
  const deadline = opts?.deadline ?? Date.now() + 25_000
  const result: TradeAutoApproveRunResult = { waiting: 0, warned: 0, approved: 0, flagged: 0, failures: [] }
  const trades = await prisma.afLeagueTrade.findMany({
    where: {
      status: 'awaiting_commissioner',
      acceptedAt: { lte: new Date(now.getTime() - WARN_HOURS * HOUR_MS) },
      league: { settings: { path: [TRADE_REVIEW_AUTO_APPROVE_KEY], equals: true } },
    },
    orderBy: { acceptedAt: 'asc' },
    take: Math.max(1, Math.min(opts?.limit ?? 50, 200)),
    select: { id: true, leagueId: true, acceptedAt: true, proposedByUserId: true, league: { select: { userId: true, name: true } } },
  })
  const flaggedIds = new Set(
    trades.length
      ? (
          await prisma.integrityFlag.findMany({
            where: { status: 'open', tradeTransactionId: { in: trades.map((t) => t.id) } },
            select: { tradeTransactionId: true },
          })
        ).map((f) => f.tradeTransactionId)
      : [],
  )

  for (const trade of trades) {
    if (Date.now() >= deadline) break
    result.waiting += 1
    const decision = autoApproveDecision({ acceptedAt: trade.acceptedAt, now, flagged: flaggedIds.has(trade.id) })
    const commissionerId = trade.league.userId
    const leagueName = trade.league.name ?? 'your league'
    try {
      if (decision === 'flagged') {
        result.flagged += 1
        continue
      }
      if (decision === 'warn') {
        await dispatchNotification({
          userIds: [commissionerId],
          category: 'commissioner_alerts',
          type: 'trade_review_auto_approve_soon',
          title: `A trade is waiting for your review · ${leagueName}`,
          body: `If you do not approve or veto it, AllFantasy approves it ${AUTO_APPROVE_HOURS} hours after it was accepted, as your league's setting says. A flagged trade always waits for you.`,
          severity: 'medium',
          leagueId: trade.leagueId,
          actionHref: `/league/${trade.leagueId}?tab=trades`,
          actionLabel: 'Review trade',
          dedupePrefix: `trade-auto-approve-warn:${trade.id}`,
          meta: { leagueId: trade.leagueId, tradeId: trade.id },
        })
          .then(() => (result.warned += 1))
          .catch(() => {})
        continue
      }
      if (decision !== 'approve') continue
      // Claimed once: a second run (or replica) finds the claim and leaves the trade alone.
      const claimed = await prisma.sportsDataCache
        .create({ data: { cacheKey: `${CLAIM_PREFIX}${trade.id}`, expiresAt: new Date(now.getTime() + 30 * 24 * HOUR_MS), data: { at: now.toISOString() } as Prisma.InputJsonValue } })
        .then(() => true)
        .catch(() => false)
      if (!claimed) continue
      try {
        await finalizeAfLeagueTradeProcessing({
          tradeId: trade.id,
          actorUserId: commissionerId,
          auditMetadata: { automatic: true, reason: 'commissioner_review_window_elapsed', hours: AUTO_APPROVE_HOURS },
        })
      } catch (e) {
        // Refused before anything moved (moves frozen, a roster gate): free the claim so a later hour
        // retries. A trade whose status changed is never retried — something did happen to it.
        const after = await prisma.afLeagueTrade.findUnique({ where: { id: trade.id }, select: { status: true } }).catch(() => null)
        if (after?.status === 'awaiting_commissioner') await prisma.sportsDataCache.delete({ where: { cacheKey: `${CLAIM_PREFIX}${trade.id}` } }).catch(() => {})
        throw e
      }
      result.approved += 1
      await logAction({
        leagueId: trade.leagueId,
        userId: commissionerId,
        actionType: TRADE_AUTO_APPROVED_ACTION,
        entityType: 'trade',
        entityId: trade.id,
        metadata: { hours: AUTO_APPROVE_HOURS, acceptedAt: trade.acceptedAt?.toISOString() ?? null },
      }).catch(() => {})
      await dispatchNotification({
        userIds: [commissionerId, trade.proposedByUserId],
        category: 'commissioner_alerts',
        type: 'trade_review_auto_approved',
        title: `Trade approved automatically · ${leagueName}`,
        body: `Nobody reviewed it within ${AUTO_APPROVE_HOURS} hours of acceptance, so AllFantasy approved it as the league's setting says. It had no integrity flags.`,
        severity: 'low',
        leagueId: trade.leagueId,
        actionHref: `/league/${trade.leagueId}?tab=trades`,
        actionLabel: 'View trade',
        dedupePrefix: `trade-auto-approved:${trade.id}`,
        meta: { leagueId: trade.leagueId, tradeId: trade.id },
      }).catch(() => {})
    } catch (e) {
      result.failures.push({ tradeId: trade.id, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}
