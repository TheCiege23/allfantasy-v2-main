import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * "If the Survivor trade check can't run: hold it for the commissioner" (`tradeCheckFailureMode: 'hold'`,
 * lib/survivor/survivorGovernanceSettings.ts). The check itself only says `holdForCommissioner`; this is
 * what an acceptance path does with that on a native redraft proposal:
 *
 *   - the proposal switches to commissioner review (`vetoMode: 'commissioner'`), the same move the
 *     "hold flagged trades" integrity hold makes, so the commissioner approves or vetoes it from the
 *     screen they already use;
 *   - a `trade_check_held` Survivor audit row marks it, and the review-window sweep
 *     (lib/redraft/tradeReviewWindowSweep.ts) leaves marked proposals for the commissioner instead of
 *     auto-passing them when the window ends.
 *
 * Best-effort on both writes: the database just failed once. If the marker cannot be written the trade
 * is still in commissioner review — it is never refused and never lost.
 */
export const SURVIVOR_TRADE_CHECK_HELD_ACTION = 'trade_check_held'
const RELATED_TYPE = 'redraft_trade_proposal'
/** How far back the sweep looks for markers: a held trade older than this has long been decided. */
const MARKER_LOOKBACK_DAYS = 60

export async function holdRedraftProposalForCommissioner(args: { leagueId: string; proposalId: string; actorUserId?: string | null }): Promise<void> {
  const warn = (step: string, error: unknown) => console.warn(`[survivor-trade-rules] hold: ${step} failed`, { proposalId: args.proposalId, error: error instanceof Error ? error.message : String(error) })
  try {
    await prisma.redraftTradeProposal.updateMany({ where: { id: args.proposalId, status: 'pending' }, data: { vetoMode: 'commissioner' } })
  } catch (error) {
    warn('review switch', error)
  }
  try {
    await prisma.survivorAuditEntry.create({
      data: {
        leagueId: args.leagueId,
        category: 'trade_rules',
        action: SURVIVOR_TRADE_CHECK_HELD_ACTION,
        actorUserId: args.actorUserId ?? null,
        relatedEntityId: args.proposalId,
        relatedEntityType: RELATED_TYPE,
        data: { reason: 'trade_check_failed' },
      },
    })
  } catch (error) {
    warn('marker write', error)
  }
}

/** Redraft proposal ids held this way, for the review-window sweep to leave alone. Never throws. */
export async function survivorHeldRedraftProposalIds(now = new Date()): Promise<string[]> {
  let rows: Array<{ relatedEntityId: string | null }> = []
  try {
    rows = await prisma.survivorAuditEntry.findMany({
      where: { action: SURVIVOR_TRADE_CHECK_HELD_ACTION, relatedEntityType: RELATED_TYPE, createdAt: { gte: new Date(now.getTime() - MARKER_LOOKBACK_DAYS * 86_400_000) } },
      select: { relatedEntityId: true },
    })
  } catch {
    // Unreadable markers: the sweep runs as it always did (held trades are already in commissioner review).
    return []
  }
  return [...new Set(rows.map((r) => r.relatedEntityId).filter((id): id is string => Boolean(id)))]
}
