import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { rosterManagerKey } from '@/lib/league/rosterManager'
import { portalMoveAlert, type PortalMove } from '@/lib/devy/portalMoves'

/**
 * Tells every manager who holds a college player's devy rights that he moved in the transfer portal
 * (rules and wording: ./portalMoves.ts). Called by the portal ingest with the moves it found new.
 *
 * Rights that are finished (promoted, expired) are not "on your devy roster" any more, so they are not
 * told. A team run by an imported manager with no AllFantasy account has no one to tell. Never throws:
 * a missed alert must not stop the ingest that found it.
 */
const ENDED_STATES = new Set(['PROMOTED_TO_PRO', 'RIGHTS_EXPIRED'])

export async function notifyPortalMoves(moves: PortalMove[]): Promise<{ notified: number }> {
  let notified = 0
  if (moves.length === 0) return { notified }
  try {
    const rights = await prisma.devyRights.findMany({
      where: { devyPlayerId: { in: moves.map((m) => m.devyPlayerId) } },
      select: { devyPlayerId: true, state: true, leagueId: true, roster: { select: { platformUserId: true, managerUserId: true } } },
    })
    const live = rights.filter((r) => !ENDED_STATES.has(String(r.state)))
    const keys = [...new Set(live.map((r) => rosterManagerKey(r.roster)).filter((k): k is string => Boolean(k)))]
    if (keys.length === 0) return { notified }
    const users = new Set((await prisma.appUser.findMany({ where: { id: { in: keys } }, select: { id: true } })).map((u) => u.id))

    for (const move of moves) {
      const holders = live.filter((r) => r.devyPlayerId === move.devyPlayerId)
      const { title, body } = portalMoveAlert(move)
      for (const r of holders) {
        const userId = rosterManagerKey(r.roster)
        if (!userId || !users.has(userId)) continue
        await dispatchNotification({
          userIds: [userId],
          leagueId: r.leagueId,
          category: 'ai_alerts',
          productType: 'app',
          type: 'devy_portal_move',
          title,
          body,
          actionHref: `/league/${encodeURIComponent(r.leagueId)}?view=roster`,
          actionLabel: 'See your roster',
          severity: 'medium',
          // One alert per player, move and league, however often the ingest runs.
          dedupePrefix: `devy-portal:${r.leagueId}:${move.devyPlayerId}:${move.kind}:${move.to ?? 'none'}`,
          meta: { devyPlayerId: move.devyPlayerId },
        }).catch(() => null)
        notified += 1
      }
    }
  } catch (e) {
    console.error('[devy-portal] alerts failed', { error: e instanceof Error ? e.message : String(e) })
  }
  return { notified }
}
