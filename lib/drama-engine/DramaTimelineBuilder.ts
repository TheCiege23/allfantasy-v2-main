/**
 * DramaTimelineBuilder — builds ordered timeline of drama events for a league/season.
 */

import { prisma } from '@/lib/prisma'
import { DEFAULT_SPORT } from '@/lib/sport-scope'
import { normalizeSportForDrama } from './SportDramaResolver'
import { publicDramaSummary } from './publicNarrative'

export interface DramaEventView {
  id: string
  leagueId: string
  sport: string
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

/**
 * Get timeline for league/season: either from DramaTimelineRecord (ordered eventIds) or by querying events and sorting by createdAt.
 */
export async function buildTimelineForLeague(
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
  const where: { leagueId: string; sport?: string; season?: number | null } = { leagueId }
  if (sportNorm) where.sport = sportNorm
  if (options?.season != null) where.season = options.season

  const sportKey = sportNorm ?? DEFAULT_SPORT
  const seasonKey = options?.season ?? null
  const timelineRecord = await prisma.dramaTimelineRecord.findFirst({
    where: { leagueId, sport: sportKey, season: seasonKey },
  })

  const limit = options?.limit ?? 50
  const offset = Math.max(0, options?.offset ?? 0)

  if (timelineRecord?.eventIds && Array.isArray(timelineRecord.eventIds) && (timelineRecord.eventIds as string[]).length > 0) {
    const ids = (timelineRecord.eventIds as string[]).slice(offset, offset + limit)
    const events = await prisma.dramaEvent.findMany({
      where: { id: { in: ids } },
    })
    const byId = new Map(events.map((e) => [e.id, e]))
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as typeof events
    return ordered
      .map(toView)
      .filter((e) => (options?.dramaType ? e.dramaType === options.dramaType : true))
      .filter((e) =>
        options?.relatedManagerId ? e.relatedManagerIds.includes(options.relatedManagerId) : true
      )
      .filter((e) =>
        options?.relatedTeamId ? e.relatedTeamIds.includes(options.relatedTeamId) : true
      )
      .filter((e) =>
        options?.relatedMatchupId ? e.relatedMatchupId === options.relatedMatchupId : true
      )
      .filter((e) =>
        options?.minScore != null ? e.dramaScore >= options.minScore : true
      )
  }

  const dbWhere = {
    ...where,
    ...(options?.dramaType ? { dramaType: options.dramaType } : {}),
    ...(options?.relatedMatchupId ? { relatedMatchupId: options.relatedMatchupId } : {}),
    ...(options?.minScore != null ? { dramaScore: { gte: options.minScore } } : {}),
  }
  const events = await prisma.dramaEvent.findMany({
    where: dbWhere,
    orderBy: [{ dramaScore: 'desc' }, { createdAt: 'desc' }],
    skip: offset,
    take: limit,
  })
  return events
    .map(toView)
    .filter((e) =>
      options?.relatedManagerId ? e.relatedManagerIds.includes(options.relatedManagerId) : true
    )
    .filter((e) =>
      options?.relatedTeamId ? e.relatedTeamIds.includes(options.relatedTeamId) : true
    )
}

function toView(e: {
  id: string
  leagueId: string
  sport: string
  season: number | null
  dramaType: string
  headline: string
  summary: string | null
  relatedManagerIds: unknown
  relatedTeamIds: unknown
  relatedMatchupId: string | null
  dramaScore: number
  createdAt: Date
}): DramaEventView {
  return {
    id: e.id,
    leagueId: e.leagueId,
    sport: e.sport,
    season: e.season,
    dramaType: e.dramaType,
    headline: e.headline,
    summary: publicDramaSummary(e.summary),
    relatedManagerIds: Array.isArray(e.relatedManagerIds) ? (e.relatedManagerIds as string[]) : [],
    relatedTeamIds: Array.isArray(e.relatedTeamIds) ? (e.relatedTeamIds as string[]) : [],
    relatedMatchupId: e.relatedMatchupId,
    dramaScore: e.dramaScore,
    createdAt: e.createdAt,
  }
}
