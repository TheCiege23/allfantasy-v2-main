/**
 * The sweep that makes a DELAYED trade actually happen.
 *
 * 🛑 WHAT WAS BROKEN. A league with `processingDelayHours > 0` gets a trade moved to
 * `status: 'scheduled'` with `scheduledProcessAt = now + delay`, and
 * `finalizeAfLeagueTradeProcessing` then RETURNS. The only thing that can finish the job is
 * somebody calling that same function again after the due time — and every caller is a human
 * action: `/api/leagues/[leagueId]/trades/[tradeId]/process`, an accept, or a commissioner
 * decision. Measured on `origin/main`: `scheduledProcessAt` appears in exactly two places in
 * production code, both of them guards INSIDE that function. Nothing queries for due trades.
 *
 * So a scheduled trade sat in `scheduled` forever unless a manager happened to reopen it and
 * press the button again. The rosters never moved, and nothing anywhere reported it.
 *
 * ⚠ THIS FILE IS HALF THE FIX. A processor nobody calls is the same bug in a new place — the
 * mistake `CLAUDE.md` records against `ingestCFBDStats`, which existed for months with no
 * scheduled caller while the surface reading its output looked healthy. The other half is the
 * guarded block in `app/api/cron/trade-grade-notify/route.ts` (every 30 min in
 * `cron-schedule.json`). Do not land one without the other.
 */

import { prisma } from '@/lib/prisma'
import { finalizeAfLeagueTradeProcessing } from '@/lib/league-trade-engine/tradeService'
import { appendAfTradeProcessingEvent } from '@/lib/league-trade-engine/tradeAudit'

/** Default cap per run. The host route is shared, so the sweep must not eat its budget. */
export const DEFAULT_SCHEDULED_TRADE_LIMIT = 25

export type ScheduledTradeSweepResult = {
  /** Trades found due this run (bounded by `limit`). */
  due: number
  /** Trades that reached `processed`. */
  processed: number
  /** One entry per trade that threw. The sweep continues past each. */
  failures: { tradeId: string; error: string }[]
}

/**
 * Resolve who to attribute the processing to.
 *
 * `finalizeAfLeagueTradeProcessing` takes an `actorUserId`, and it is not decorative:
 * `assertRosterTransactionsAllowed` uses it for the commissioner bypass on an illegal roster.
 * Inventing a system id would silently change that decision, so the actor is the user whose
 * action scheduled the trade — recorded on the status-history row that moved it to `scheduled`.
 * The proposer is the fallback, never a synthetic account.
 */
async function resolveSchedulingActor(tradeId: string, proposedByUserId: string): Promise<string> {
  const history = await prisma.afLeagueTradeStatusHistory.findFirst({
    where: { tradeId, toStatus: 'scheduled' },
    orderBy: { createdAt: 'desc' },
    select: { actorUserId: true },
  })
  return history?.actorUserId || proposedByUserId
}

export async function processDueScheduledTrades(opts?: {
  limit?: number
  /** Injectable for tests. Production passes nothing. */
  now?: Date
}): Promise<ScheduledTradeSweepResult> {
  const now = opts?.now ?? new Date()
  const limit = Math.max(1, Math.min(opts?.limit ?? DEFAULT_SCHEDULED_TRADE_LIMIT, 200))

  // Oldest first: a backlog drains in order across runs rather than starving the trades that
  // have been waiting longest, and the bound keeps the shared host route inside its budget.
  const due = await prisma.afLeagueTrade.findMany({
    where: { status: 'scheduled', scheduledProcessAt: { lte: now } },
    orderBy: { scheduledProcessAt: 'asc' },
    take: limit,
    select: { id: true, proposedByUserId: true },
  })

  const result: ScheduledTradeSweepResult = { due: due.length, processed: 0, failures: [] }

  for (const trade of due) {
    try {
      const actorUserId = await resolveSchedulingActor(trade.id, trade.proposedByUserId)
      await finalizeAfLeagueTradeProcessing({ tradeId: trade.id, actorUserId })
      result.processed += 1
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      result.failures.push({ tradeId: trade.id, error })

      // ⚠ A TRADE THAT CANNOT BE PROCESSED MUST NOT FAIL SILENTLY FOREVER. Without this row the
      // trade stays `scheduled`, gets picked up again next run, fails again, and the only trace is
      // a log line nobody reads — which is the shape of the bug this file exists to close.
      // Best-effort: a failed audit write must not abort the rest of the sweep.
      await appendAfTradeProcessingEvent({
        tradeId: trade.id,
        eventType: 'trade_schedule_processing_failed',
        payload: { error, attemptedAt: now.toISOString() },
      }).catch((auditError) =>
        console.error('[scheduled-trades] could not record the failure', trade.id, auditError),
      )
    }
  }

  return result
}
