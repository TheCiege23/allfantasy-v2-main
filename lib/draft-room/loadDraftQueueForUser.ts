/**
 * Shared draft queue load for current user — used by GET /draft/queue and live-sync bundle.
 */

import { prisma } from '@/lib/prisma'
import type { QueueEntry } from '@/lib/live-draft-engine/types'
import {
  dedupeQueueEntries,
  normalizeDraftedNameSet,
  normalizeQueueEntries,
  removeDraftedPlayersFromQueue,
} from '@/lib/draft-queue-engine'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export async function loadDraftQueueForUser(leagueId: string, userId: string): Promise<{
  queue: QueueEntry[]
  removedUnavailable: number
}> {
  const draftSession = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: {
      id: true,
      picks: {
        select: { playerName: true },
      },
    },
  })
  if (!draftSession) {
    return { queue: [], removedUnavailable: 0 }
  }

  const row = await prisma.draftQueue.findUnique({
    where: { sessionId_userId: { sessionId: draftSession.id, userId } },
  })
  const rawOrder = (row?.order as unknown as QueueEntry[]) ?? []
  const draftedNames = normalizeDraftedNameSet(draftSession.picks)
  const cleaned = removeDraftedPlayersFromQueue(dedupeQueueEntries(rawOrder), draftedNames)
  if (row && cleaned.removedCount > 0) {
    await prisma.draftQueue.update({
      where: { sessionId_userId: { sessionId: draftSession.id, userId } },
      data: { order: cleaned.queue as never, updatedAt: new Date() },
    })
  }
  return { queue: cleaned.queue, removedUnavailable: cleaned.removedCount }
}
