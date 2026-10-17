/**
 * DramaQueryService — query drama events by league, sport, season, type.
 */

import { prisma } from '@/lib/prisma'
import { buildTimelineForLeague } from './DramaTimelineBuilder'
import { getDramaSportLabel, normalizeSportForDrama } from './SportDramaResolver'
import { publicDramaSummary } from './publicNarrative'

export interface DramaEventView {
  id: string
  leagueId: string
  sport: string
  sportLabel: string
  season: number | null
  dramaType: string
  headline: string
  summary: string | null
  relatedManagerIds: string[]
  relatedTeamIds: string[]
  relatedMatchupId: string | null
  dramaScore: number
  createdAt: Date
}

export async function listDramaEvents(
  leagueId: string,
  options?: {
    sport?: string
    season?: number | null
    dramaType?: string
    relatedManagerId?: string
    relatedTeamId?: string
    relatedMatchupId?: string
    minScore?: number
    limit?: number
    offset?: number
  }
): Promise<DramaEventView[]> {
  const sportNorm = normalizeSportForDrama(options?.sport)
  const where: {
    leagueId: string
    sport?: string
    season?: number | null
    dramaType?: string
    relatedMatchupId?: string
    dramaScore?: { gte: number }
  } = { leagueId }
  if (sportNorm) where.sport = sportNorm
  if (options?.season != null) where.season = options.season
  if (options?.dramaType) where.dramaType = options.dramaType
  if (options?.relatedMatchupId) where.relatedMatchupId = options.relatedMatchupId
  if (options?.minScore != null) where.dramaScore = { gte: options.minScore }

  const events = await prisma.dramaEvent.findMany({
    where,
    orderBy: [{ dramaScore: 'desc' }, { createdAt: 'desc' }],
    skip: Math.max(0, options?.offset ?? 0),
    take: options?.limit ?? 30,
  })
  return events
    .map((e) => ({
      ...e,
      summary: publicDramaSummary(e.summary),
      sportLabel: getDramaSportLabel(e.sport),
      relatedManagerIds: Array.isArray(e.relatedManagerIds) ? (e.relatedManagerIds as string[]) : [],
      relatedTeamIds: Array.isArray(e.relatedTeamIds) ? (e.relatedTeamIds as string[]) : [],
    }))
    .filter((e) =>
      options?.relatedManagerId ? e.relatedManagerIds.includes(options.relatedManagerId) : true
    )
    .filter((e) =>
      options?.relatedTeamId ? e.relatedTeamIds.includes(options.relatedTeamId) : true
    )
}

export async function getDramaEventById(eventId: string): Promise<DramaEventView | null> {
  const e = await prisma.dramaEvent.findUnique({ where: { id: eventId } })
  if (!e) return null
  return {
    ...e,
    summary: publicDramaSummary(e.summary),
    sportLabel: getDramaSportLabel(e.sport),
    relatedManagerIds: Array.isArray(e.relatedManagerIds) ? (e.relatedManagerIds as string[]) : [],
    relatedTeamIds: Array.isArray(e.relatedTeamIds) ? (e.relatedTeamIds as string[]) : [],
  }
}

export { buildTimelineForLeague }
