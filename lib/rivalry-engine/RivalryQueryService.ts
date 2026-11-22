/**
 * RivalryQueryService — get rivalries by league (sport, manager), get one rivalry, get timeline.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { RivalryTier } from './types'
import { getRivalryTierBadgeColor } from './RivalryTierResolver'
import { getRivalrySportLabel, normalizeSportForRivalry } from './SportRivalryResolver'

export interface RivalryRecordView {
  id: string
  leagueId: string
  sport: string
  sportLabel: string
  managerAId: string
  managerBId: string
  rivalryScore: number
  rivalryTier: RivalryTier
  tierBadgeColor: string
  firstDetectedAt: Date
  updatedAt: Date
  eventCount?: number
}

function canonicalOrder(id1: string, id2: string): [string, string] {
  return id1 <= id2 ? [id1, id2] : [id2, id1]
}

/**
 * List rivalries for a league with optional sport and manager filters.
 */
export async function listRivalries(
  leagueId: string,
  options?: {
    sport?: string
    season?: number
    managerId?: string
    managerAId?: string
    managerBId?: string
    limit?: number
  }
): Promise<RivalryRecordView[]> {
  const where: Prisma.RivalryRecordWhereInput = {
    leagueId,
  }
  const sportNorm = normalizeSportForRivalry(options?.sport)
  if (sportNorm) where.sport = sportNorm
  if (options?.season != null) {
    where.events = { some: { season: options.season } }
  }
  if (options?.managerAId && options?.managerBId) {
    const [a, b] = canonicalOrder(options.managerAId, options.managerBId)
    where.AND = [{ managerAId: a }, { managerBId: b }]
  }
  if (options?.managerId) {
    const mid = options.managerId
    where.OR = [{ managerAId: mid }, { managerBId: mid }]
  }

  const records = await prisma.rivalryRecord.findMany({
    where,
    include: { _count: { select: { events: true } } },
    orderBy: [{ rivalryScore: 'desc' }, { updatedAt: 'desc' }],
    take: options?.limit ?? 50,
  })

  return records.map((r) => ({
    id: r.id,
    leagueId: r.leagueId,
    sport: r.sport,
    sportLabel: getRivalrySportLabel(r.sport),
    managerAId: r.managerAId,
    managerBId: r.managerBId,
    rivalryScore: r.rivalryScore,
    rivalryTier: r.rivalryTier as RivalryTier,
    tierBadgeColor: getRivalryTierBadgeColor(r.rivalryTier as RivalryTier),
    firstDetectedAt: r.firstDetectedAt,
    updatedAt: r.updatedAt,
    eventCount: r._count.events,
  }))
}

/**
 * Get a single rivalry by id.
 */
export async function getRivalryById(rivalryId: string): Promise<RivalryRecordView | null> {
  const r = await prisma.rivalryRecord.findUnique({
    where: { id: rivalryId },
    include: { _count: { select: { events: true } } },
  })
  if (!r) return null
  return {
    id: r.id,
    leagueId: r.leagueId,
    sport: r.sport,
    sportLabel: getRivalrySportLabel(r.sport),
    managerAId: r.managerAId,
    managerBId: r.managerBId,
    rivalryScore: r.rivalryScore,
    rivalryTier: r.rivalryTier as RivalryTier,
    tierBadgeColor: getRivalryTierBadgeColor(r.rivalryTier as RivalryTier),
    firstDetectedAt: r.firstDetectedAt,
    updatedAt: r.updatedAt,
    eventCount: r._count.events,
  }
}

/**
 * Get rivalry by league and manager pair (canonical order).
 */
export async function getRivalryByPair(
  leagueId: string,
  managerAId: string,
  managerBId: string
): Promise<RivalryRecordView | null> {
  const [a, b] = canonicalOrder(managerAId, managerBId)
  const r = await prisma.rivalryRecord.findUnique({
    where: { leagueId_managerAId_managerBId: { leagueId, managerAId: a, managerBId: b } },
    include: { _count: { select: { events: true } } },
  })
  if (!r) return null
  return {
    id: r.id,
    leagueId: r.leagueId,
    sport: r.sport,
    sportLabel: getRivalrySportLabel(r.sport),
    managerAId: r.managerAId,
    managerBId: r.managerBId,
    rivalryScore: r.rivalryScore,
    rivalryTier: r.rivalryTier as RivalryTier,
    tierBadgeColor: getRivalryTierBadgeColor(r.rivalryTier as RivalryTier),
    firstDetectedAt: r.firstDetectedAt,
    updatedAt: r.updatedAt,
    eventCount: r._count.events,
  }
}

export { buildTimelineForRivalry } from './RivalryTimelineBuilder'
