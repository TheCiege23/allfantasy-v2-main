import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeDraftQueueSizeLimit } from '@/lib/draft-defaults/DraftQueueLimitResolver'
import {
  dedupeQueueEntries,
  normalizeDraftedNameSet,
  normalizeQueueEntries,
  removeDraftedPlayersFromQueue,
} from '@/lib/draft-queue-engine'
import { stripAiQueueMetadata } from '@/lib/live-draft-engine/draftQueueAiPreferences'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import type { QueueEntry } from '@/lib/live-draft-engine/types'

/**
 * The ONE way a user's draft queue is saved — the draft room's `PUT /api/leagues/[leagueId]/draft/queue`
 * and a confirmed Chimmy queue card (`lib/chimmy/actions/queueAction.ts`) both come through here.
 *
 * Moved out of the route on 2026-11-16 so Chimmy could not grow a second, drifting copy of the hygiene
 * chain: normalize to the league's queue size → dedupe → strip AI-reorder metadata → refuse a position
 * that is not draft-eligible → drop players already drafted → upsert by (sessionId, userId).
 *
 * Split in two so a caller can VALIDATE without writing (Chimmy checks a proposed queue before it ever
 * shows a card) and so the route can run its AF Pro preference write between the checks and the save.
 */

export type PreparedDraftQueue = {
  sessionId: string
  queue: QueueEntry[]
  removedCount: number
  queueSizeLimit: number
}

export type PrepareDraftQueueResult =
  | { ok: true; prepared: PreparedDraftQueue }
  | { ok: false; status: 400 | 404; error: string }

/** Everything the save does except the write. Never writes. */
export async function prepareDraftQueueSave(leagueId: string, queue: unknown[]): Promise<PrepareDraftQueueResult> {
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
  if (!draftSession) return { ok: false, status: 404, error: 'No draft session' }

  const { getDraftConfigForLeague } = await import('@/lib/draft-defaults/DraftRoomConfigResolver')
  const draftConfig = await getDraftConfigForLeague(leagueId)
  const queueSizeLimit = normalizeDraftQueueSizeLimit(draftConfig?.queue_size_limit)

  let normalized = dedupeQueueEntries(normalizeQueueEntries(queue, queueSizeLimit))
  normalized = stripAiQueueMetadata(normalized)

  const { draftPoolRowMatchesEligiblePositions } = await import('@/lib/draft-room/draft-pool-eligible-positions')
  const { getAllowedPositionsAndRosterSize } = await import('@/lib/live-draft-engine/RosterFitValidation')
  const rosterRules = await getAllowedPositionsAndRosterSize(leagueId)
  if (rosterRules?.draftEligiblePositions?.size) {
    const invalid = normalized.filter((e: { position: string }) => {
      const pos = (e.position ?? '').trim()
      return pos && !draftPoolRowMatchesEligiblePositions(pos, rosterRules!.draftEligiblePositions)
    })
    if (invalid.length > 0) {
      const positions = [...new Set(invalid.map((e: { position: string }) => (e.position || '').trim() || '?'))]
      return {
        ok: false,
        status: 400,
        error: `Queue contains players with positions not starter-eligible for this draft: ${positions.join(', ')}. Allowed positions: ${[...rosterRules.draftEligiblePositions].sort().join(', ')}.`,
      }
    }
  }

  const draftedNames = normalizeDraftedNameSet(draftSession.picks)
  const cleaned = removeDraftedPlayersFromQueue(normalized, draftedNames)
  return { ok: true, prepared: { sessionId: draftSession.id, queue: cleaned.queue, removedCount: cleaned.removedCount, queueSizeLimit } }
}

/** The write: the prepared queue, keyed by (sessionId, userId). */
export async function persistDraftQueue(userId: string, prepared: PreparedDraftQueue): Promise<void> {
  const draftSession = { id: prepared.sessionId }
  await prisma.draftQueue.upsert({
    where: { sessionId_userId: { sessionId: draftSession.id, userId } },
    create: { sessionId: draftSession.id, userId, order: prepared.queue as never },
    update: { order: prepared.queue as never, updatedAt: new Date() },
  })
}
