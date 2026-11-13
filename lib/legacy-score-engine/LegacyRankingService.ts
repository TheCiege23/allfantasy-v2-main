/**
 * LegacyRankingService — query legacy scores for leaderboards and profile views.
 */

import { prisma } from '@/lib/prisma'
import { normalizeSportForLegacy } from './SportLegacyResolver'
import type { LegacyQueryFilters } from './types'

export interface LegacyScoreRow {
  id: string
  entityType: string
  entityId: string
  sport: string
  leagueId: string | null
  overallLegacyScore: number
  championshipScore: number
  playoffScore: number
  consistencyScore: number
  rivalryScore: number
  awardsScore: number
  dynastyScore: number
  updatedAt: Date
}

function toRow(r: {
  id: string
  entityType: string
  entityId: string
  sport: string
  leagueId: string | null
  overallLegacyScore: any
  championshipScore: any
  playoffScore: any
  consistencyScore: any
  rivalryScore: any
  awardsScore: any
  dynastyScore: any
  updatedAt: Date
}): LegacyScoreRow {
  return {
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    sport: r.sport,
    leagueId: r.leagueId,
    overallLegacyScore: Number(r.overallLegacyScore),
    championshipScore: Number(r.championshipScore),
    playoffScore: Number(r.playoffScore),
    consistencyScore: Number(r.consistencyScore),
    rivalryScore: Number(r.rivalryScore),
    awardsScore: Number(r.awardsScore),
    dynastyScore: Number(r.dynastyScore),
    updatedAt: r.updatedAt,
  }
}

function asKey(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

async function resolveEntityAliases(input: {
  leagueId: string | null
  entityType: string
  entityId: string
}): Promise<string[]> {
  const base = String(input.entityId ?? '').trim()
  if (!base || !input.leagueId) return base ? [base] : []
  const normalized = asKey(base)
  const aliases = new Set<string>([base])

  const league = await prisma.league
    .findUnique({
      where: { id: input.leagueId },
      select: {
        rosters: { select: { id: true, platformUserId: true } },
        teams: { select: { id: true, externalId: true, ownerName: true, teamName: true } },
      },
    })
    .catch(() => null)
  if (!league) return [...aliases]

  for (const roster of league.rosters) {
    if (asKey(roster.id) === normalized || asKey(roster.platformUserId) === normalized) {
      aliases.add(String(roster.id))
      aliases.add(String(roster.platformUserId))
    }
  }
  for (const team of league.teams) {
    const matched =
      asKey(team.id) === normalized ||
      asKey(team.externalId) === normalized ||
      asKey(team.ownerName) === normalized ||
      asKey(team.teamName) === normalized
    if (matched) {
      if (team.id) aliases.add(String(team.id))
      if (team.externalId) aliases.add(String(team.externalId))
      if (team.ownerName) aliases.add(String(team.ownerName))
      if (team.teamName) aliases.add(String(team.teamName))
    }
  }
  return [...aliases].filter(Boolean)
}

export async function queryLegacyLeaderboard(
  filters: LegacyQueryFilters
): Promise<{ records: LegacyScoreRow[]; total: number }> {
  const sport = filters.sport ? normalizeSportForLegacy(filters.sport) : undefined
  const where: Record<string, unknown> = {}
  if (sport) where.sport = sport
  if (filters.leagueId != null) where.leagueId = filters.leagueId
  if (filters.entityType != null) where.entityType = filters.entityType

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
  const offset = Math.max(filters.offset ?? 0, 0)

  const [records, total] = await Promise.all([
    prisma.legacyScoreRecord.findMany({
      where,
      orderBy: [{ overallLegacyScore: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
      skip: offset,
    }),
    prisma.legacyScoreRecord.count({ where }),
  ])

  const rows: LegacyScoreRow[] = records.map(toRow)

  return { records: rows, total }
}

export async function getLegacyScoreByEntity(
  entityType: string,
  entityId: string,
  sport: string,
  leagueId: string | null
): Promise<LegacyScoreRow | null> {
  const sportNorm = normalizeSportForLegacy(sport)
  const aliases = await resolveEntityAliases({
    leagueId,
    entityType,
    entityId,
  })

  const r = await prisma.legacyScoreRecord.findFirst({
    where: {
      entityType,
      ...(aliases.length > 0 ? { entityId: { in: aliases } } : { entityId }),
      sport: sportNorm,
      leagueId: leagueId ?? null,
    },
    orderBy: [{ updatedAt: 'desc' }],
  })
  if (!r) return null
  return toRow(r)
}

