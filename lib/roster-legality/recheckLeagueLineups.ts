/**
 * Re-check every saved lineup after the league's roster layout changed (2026-11-15).
 *
 * 🛑 A SLOT CHANGE LEFT SAVED LINEUPS UNCHECKED. A commissioner who removed a FLEX or a second RB saved the new layout
 * and every team kept a lineup the league no longer allows; nothing said so until a lock or a scoring run tripped on
 * it. The roster editor's save now runs the same legality check the roster page uses on every team, tells the
 * commissioner how many need moves, and alerts those managers with a link to their roster.
 *
 * Read-only: nothing is moved on anyone's behalf. Never throws.
 */
import { prisma } from '@/lib/prisma'
import { evaluateLegalityForPersistedRoster } from './loadLegalityEvaluationContext'
import { isSeatPlaceholderUserId } from '@/lib/orphan-ai-manager/orphan-platform-ids'

export type LineupNeedingFix = { rosterId: string; userId: string | null; requiredMoves: number }

/** A person to alert, or null for an empty seat / AI-managed placeholder. */
function personUserId(platformUserId: string | null | undefined): string | null {
  const id = String(platformUserId ?? '').trim()
  return id && !isSeatPlaceholderUserId(id) ? id : null
}

export async function findLineupsNeedingFixes(leagueId: string): Promise<LineupNeedingFix[]> {
  try {
    const rosters = await prisma.roster.findMany({
      where: { leagueId },
      select: { id: true, leagueId: true, playerData: true, platformUserId: true },
    })
    const out: LineupNeedingFix[] = []
    for (const roster of rosters) {
      const evaluated = await evaluateLegalityForPersistedRoster(roster).catch(() => null)
      if (!evaluated || evaluated.result.isLegal) continue
      out.push({ rosterId: roster.id, userId: personUserId(roster.platformUserId), requiredMoves: evaluated.result.requiredMovesCount })
    }
    return out
  } catch (e) {
    console.warn('[lineup-recheck] failed', { leagueId, error: e instanceof Error ? e.message : String(e) })
    return []
  }
}

/** Alert the managers whose saved lineup no longer fits. Best-effort. */
export async function alertManagersToFixLineups(leagueId: string, needing: readonly LineupNeedingFix[]): Promise<void> {
  const userIds = [...new Set(needing.map((n) => n.userId).filter((u): u is string => Boolean(u)))]
  if (userIds.length === 0) return
  try {
    const { dispatchNotification } = await import('@/lib/notifications/NotificationDispatcher')
    await dispatchNotification({
      userIds,
      category: 'lineup_alerts',
      type: 'lineup_needs_fix_after_roster_change',
      title: 'Your lineup needs a change',
      body: 'Your commissioner changed the league\'s roster spots, and your saved lineup no longer fits. Open your roster to fix it.',
      actionHref: `/league/${encodeURIComponent(leagueId)}?tab=team`,
      actionLabel: 'Fix lineup',
      leagueId,
      severity: 'medium',
      dedupePrefix: `lineup-recheck:${leagueId}:${new Date().toISOString().slice(0, 10)}`,
    })
  } catch (e) {
    console.warn('[lineup-recheck] alert failed', { leagueId, error: e instanceof Error ? e.message : String(e) })
  }
}
