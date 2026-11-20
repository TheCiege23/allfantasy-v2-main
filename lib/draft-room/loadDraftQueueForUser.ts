/**
 * Shared draft queue load for current user — used by GET /draft/queue and live-sync bundle.
 */

import { loadPlayerPools } from '@/lib/league/player-pools/load'
import { queuePicksInPool } from '@/lib/league/player-pools/policy'
import { getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { draftQueueKeyForUser } from '@/lib/league/teamScopedKey'
import { prisma } from '@/lib/prisma'
import type { QueueEntry } from '@/lib/live-draft-engine/types'
import { dedupeQueueEntries, normalizeDraftedNameSet, removeDraftedPlayersFromQueue } from '@/lib/draft-queue-engine'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export async function loadDraftQueueForUser(
  leagueId: string,
  userId: string,
  /** The queue to read when the caller already knows the team (lib/league/rosterManager.ts `teamScopedKey`). */
  opts: { queueKey?: string | null; rosterId?: string | null } = {},
): Promise<{
  queue: QueueEntry[]
  removedUnavailable: number
}> {
  const draftSession = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: {
      id: true,
      picks: {
        select: { playerName: true, rosterId: true },
      },
    },
  })
  if (!draftSession) {
    return { queue: [], removedUnavailable: 0 }
  }

  // Each team has its own queue: a manager's first team under their user id, a further team under its own key.
  const rosterId = opts.rosterId === undefined ? await getCurrentUserRosterIdForLeague(leagueId, userId) : opts.rosterId
  const queueKey = opts.queueKey || (await draftQueueKeyForUser(leagueId, userId, rosterId))
  const row = await prisma.draftQueue.findUnique({
    where: { sessionId_userId: { sessionId: draftSession.id, userId: queueKey } },
  })
  const rawOrder = (row?.order as unknown as QueueEntry[]) ?? []
  if (!rawOrder.length) return { queue: [], removedUnavailable: 0 }
  const pools = await loadPlayerPools(leagueId)
  const draftedNames = normalizeDraftedNameSet(queuePicksInPool(draftSession.picks, pools, rosterId))
  const cleaned = removeDraftedPlayersFromQueue(dedupeQueueEntries(rawOrder), draftedNames)
  if (row && cleaned.removedCount > 0) {
    await prisma.draftQueue.updateMany({
      where: { id: row.id, updatedAt: row.updatedAt },
      data: { order: cleaned.queue as never, updatedAt: new Date() },
    })
  }
  return { queue: cleaned.queue, removedUnavailable: cleaned.removedCount }
}
