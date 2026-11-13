/**
 * RivalryTimelineBuilder — builds timeline view from RivalryEvent for a rivalry or league.
 */

import { prisma } from '@/lib/prisma'
import type { RivalryEventType } from './types'

interface RivalryTimelineItem {
  eventId: string
  rivalryId: string
  eventType: RivalryEventType
  season: number | null
  matchupId: string | null
  tradeId: string | null
  description: string | null
  createdAt: Date
}

/**
 * Get timeline for a single rivalry (all events, newest first).
 */
export async function buildTimelineForRivalry(rivalryId: string): Promise<RivalryTimelineItem[]> {
  const events = await prisma.rivalryEvent.findMany({
    where: { rivalryId },
    orderBy: { createdAt: 'desc' },
  })
  return events.map((e) => ({
    eventId: e.id,
    rivalryId: e.rivalryId,
    eventType: e.eventType as RivalryEventType,
    season: e.season,
    matchupId: e.matchupId,
    tradeId: e.tradeId,
    description: e.description,
    createdAt: e.createdAt,
  }))
}

