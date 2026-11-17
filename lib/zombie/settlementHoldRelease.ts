import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logAuditEntry } from './auditService'
import { runWeeklyResolution, type WeeklyResolutionRunResult } from './weeklyResolutionEngine'
import { SETTLEMENT_RELEASED_ACTION, readSettlementHold } from './settlementHoldReasons'

/**
 * Read and release a zombie week held for review (`review_required`).
 *
 * 🛑 A HELD WEEK COULD NEVER BE RELEASED, SO THE SEASON STALLED. The weekly settlement returns early for a held week
 * (lib/zombie/weeklyResolutionEngine.ts) and nothing anywhere moved a week out of `review_required`. The NFL
 * correction tool needs a COMPLETE week and so cannot reach a held one, and outside NFL nothing could. The
 * commissioner saw "needs commissioner review" with nothing to press.
 *
 * WHY A RETRY IS SAFE: the settlement holds a week only while it captures the week's settlement snapshot, BEFORE the
 * first side effect (infections, items, combat, winnings all come after). So a held week has changed nothing, and
 * running it again cannot apply anything twice. This module refuses a release unless that is still visibly true —
 * no `resolvedAt`, no recorded matchup results — and the reset is a conditional update on `status: 'review_required'`,
 * so two commissioners pressing at once release it once.
 *
 * A release does not force anything through: it puts the week back to `pending`, drops the stale snapshot (so it is
 * captured again from today's state, after whatever the commissioner fixed), and runs the ordinary settlement. If
 * the cause is still there, the week is held again with the same reason.
 */

// The read lives beside the reasons, so a reader (the weekly checklist) does not load the settlement engine.
export { readSettlementHold, type SettlementHoldView } from './settlementHoldReasons'

export type ReleaseResult =
  | { ok: true; outcome: 'settled' | 'held_again' | 'waiting'; detail: string; run: WeeklyResolutionRunResult }
  | { ok: false; status: 404 | 409; error: string }

export async function releaseSettlementHold(input: { zombieLeagueId: string; week: number; actorUserId: string }): Promise<ReleaseResult> {
  const { zombieLeagueId, week, actorUserId } = input
  const league = await prisma.zombieLeague.findUnique({ where: { id: zombieLeagueId }, select: { correctionHoldFromWeek: true } })
  if (!league) return { ok: false, status: 404, error: 'Zombie league not found.' }
  if (league.correctionHoldFromWeek != null) {
    return { ok: false, status: 409, error: 'A reviewed stat correction is in progress. Finish it with the correction tool first.' }
  }
  const row = await prisma.zombieWeeklyResolution.findUnique({
    where: { zombieLeagueId_week: { zombieLeagueId, week } },
    select: { id: true, status: true, resolvedAt: true, matchupResults: true },
  })
  if (!row || row.status !== 'review_required') return { ok: false, status: 409, error: `Week ${week} is not on hold.` }
  const hasResults = Array.isArray(row.matchupResults) ? row.matchupResults.length > 0 : row.matchupResults != null
  if (row.resolvedAt || hasResults) {
    // Not the pre-side-effect hold this release is for: something was already applied. Never replay it from here.
    return { ok: false, status: 409, error: `Week ${week} already has settlement results. Use the correction tool, or contact AllFantasy support.` }
  }

  const before = await readSettlementHold(zombieLeagueId)
  const released = await prisma.zombieWeeklyResolution.updateMany({
    where: { id: row.id, status: 'review_required', resolvedAt: null },
    data: { status: 'pending', settlementSnapshot: Prisma.DbNull, requiresStatCorrection: false },
  })
  if (released.count === 0) return { ok: false, status: 409, error: `Week ${week} changed while you were releasing it. Reload and try again.` }

  await logAuditEntry(zombieLeagueId, {
    category: 'commissioner_override',
    action: SETTLEMENT_RELEASED_ACTION,
    description: `Commissioner retried the week ${week} settlement.`,
    week,
    actorUserId,
    actorRole: 'commissioner',
    previousState: { status: 'review_required', reason: before?.week === week ? before.reason.code : null },
    newState: { status: 'pending' },
  })

  const run = await runWeeklyResolution(zombieLeagueId, week)
  if (run.resolution?.status === 'complete') return { ok: true, outcome: 'settled', detail: `Week ${week} settled.`, run }
  if (run.resolution?.status === 'review_required') {
    const again = await readSettlementHold(zombieLeagueId)
    return { ok: true, outcome: 'held_again', detail: again?.reason.text ?? `Week ${week} is on hold again.`, run }
  }
  return { ok: true, outcome: 'waiting', detail: `Week ${week} is released and will settle on the next run (${run.reason ?? 'waiting'}).`, run }
}
