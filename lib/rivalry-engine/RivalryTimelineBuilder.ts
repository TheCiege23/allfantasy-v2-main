/**
 * RivalryTimelineBuilder — builds timeline view from RivalryEvent for a rivalry or league.
 */

import { prisma } from '@/lib/prisma'
import type { RivalryEventType } from './types'
import { normalizeSportForRivalry } from './SportRivalryResolver'

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

/**
 * Get timeline for all rivalries in a league (optional sport/season filter), newest first.
 */
export async function buildTimelineForLeague(
  leagueId: string,
  options?: { sport?: string; season?: number; limit?: number }
): Promise<RivalryTimelineItem[]> {
  const sportNorm = normalizeSportForRivalry(options?.sport)
  const where: { rivalry: { leagueId: string; sport?: string }; season?: number } = {
    rivalry: { leagueId },
  }
  if (sportNorm) where.rivalry.sport = sportNorm
  if (options?.season != null) where.season = options.season

  const events = await prisma.rivalryEvent.findMany({
    where,
    include: { rivalry: true },
    orderBy: { createdAt: 'desc' },
    take: options?.limit ?? 100,
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
