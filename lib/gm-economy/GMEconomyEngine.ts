/**
 * GMEconomyEngine — orchestrates career aggregation, profile upsert, and progression events.
 */

import { prisma } from '@/lib/prisma'
import { aggregateCareerForManager } from './CareerProgressionAggregator'
import { GM_PROGRESSION_EVENT_TYPES, type GMProgressionEventType } from './types'
import { normalizeSportForGMCareer } from './SportCareerResolver'
import { getMergedHistoricalSeasonResultsForManager } from '@/lib/season-results/HistoricalSeasonResultService'
import { DEFAULT_SPORT } from '@/lib/sport-scope'

export interface GMEconomyRunResult {
  managerId: string
  profileId: string
  gmPrestigeScore: number
  franchiseValue: number
  created: boolean
  progressionEventsCreated: number
}

/**
 * Generated GM progression events that can be rebuilt idempotently from persisted records.
 */
const GENERATED_EVENT_TYPES: readonly GMProgressionEventType[] = GM_PROGRESSION_EVENT_TYPES

type ProgressionEventSeed = {
  managerId: string
  sport: string
  eventType: GMProgressionEventType
  valueChange: number
  sourceReference: string
  createdAt: Date
}

function buildSeasonDate(season: string | null | undefined): Date {
  const parsed = Number.parseInt(season ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < 1970 || parsed > 2200) {
    return new Date()
  }
  return new Date(Date.UTC(parsed, 11, 31, 0, 0, 0, 0))
}

function toEventValue(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Number(value.toFixed(4))
}

function isFinalsAppearance(args: {
  champion: boolean
  bestFinish: number | null
  playoffFinish: string | null
}): boolean {
  if (args.champion) return true
  if (args.bestFinish === 2) return true
  const finish = (args.playoffFinish ?? '').toLowerCase()
  return finish.includes('runner-up') || finish.includes('final')
}

async function createProgressionEventsForManager(managerId: string): Promise<number> {
  const rosters = await prisma.roster.findMany({
    where: { platformUserId: managerId },
    select: { id: true, leagueId: true, platformUserId: true, playerData: true, createdAt: true },
  })
  if (rosters.length === 0) return 0

  const leagueIds = [...new Set(rosters.map((r) => r.leagueId).filter(Boolean))]
  const leagues =
    leagueIds.length > 0
      ? await prisma.league.findMany({
          where: { id: { in: leagueIds } },
          select: { id: true, sport: true },
        })
      : []
  const sportByLeagueId = new Map(
    leagues.map((league) => [league.id, normalizeSportForGMCareer(league.sport)])
  )

  const allSeeds: ProgressionEventSeed[] = []
  const earliestRosterByLeague = new Map<string, Date>()
  for (const roster of rosters) {
    const prev = earliestRosterByLeague.get(roster.leagueId)
    if (!prev || roster.createdAt < prev) {
      earliestRosterByLeague.set(roster.leagueId, roster.createdAt)
    }
  }
  for (const leagueId of leagueIds) {
    allSeeds.push({
      managerId,
      sport: sportByLeagueId.get(leagueId) ?? DEFAULT_SPORT,
      eventType: 'league_joined',
      valueChange: 1,
      sourceReference: `league_joined:${leagueId}`,
      createdAt: earliestRosterByLeague.get(leagueId) ?? new Date(),
    })
  }

  const mergedCareer = await getMergedHistoricalSeasonResultsForManager({
    managerId,
    rosters,
  })
  for (const seasonRow of mergedCareer) {
    const sport = sportByLeagueId.get(seasonRow.leagueId) ?? DEFAULT_SPORT
    const seasonRef = `${seasonRow.leagueId}:${seasonRow.season}`
    const eventDate = buildSeasonDate(seasonRow.season)
    const wins = Math.max(0, seasonRow.wins ?? 0)
    const losses = Math.max(0, seasonRow.losses ?? 0)
    const gamesPlayed = wins + losses

    allSeeds.push({
      managerId,
      sport,
      eventType: 'season_completed',
      valueChange: gamesPlayed > 0 ? toEventValue(wins / gamesPlayed) : 1,
      sourceReference: `season_completed:${seasonRef}`,
      createdAt: eventDate,
    })

    if (seasonRow.madePlayoffs || seasonRow.champion) {
      allSeeds.push({
        managerId,
        sport,
        eventType: 'playoff_appearance',
        valueChange: 1,
        sourceReference: `playoff_appearance:${seasonRef}`,
        createdAt: eventDate,
      })
    }

    if (
      isFinalsAppearance({
        champion: seasonRow.champion,
        bestFinish: seasonRow.bestFinish,
        playoffFinish: seasonRow.playoffFinish,
      })
    ) {
      allSeeds.push({
        managerId,
        sport,
        eventType: 'finals_appearance',
        valueChange: 1,
        sourceReference: `finals_appearance:${seasonRef}`,
        createdAt: eventDate,
      })
    }

    if (seasonRow.champion) {
      allSeeds.push({
        managerId,
        sport,
        eventType: 'championship',
        valueChange: 1,
        sourceReference: `championship:${seasonRef}`,
        createdAt: eventDate,
      })
    }
  }

  const [reputationRows, legacyRows, hallOfFameRows] = await Promise.all([
    prisma.managerReputationRecord.findMany({
      where: { managerId },
      select: { id: true, sport: true, tier: true, overallScore: true, updatedAt: true },
    }),
    prisma.legacyScoreRecord.findMany({
      where: { entityType: 'MANAGER', entityId: managerId },
      select: { id: true, sport: true, overallLegacyScore: true, updatedAt: true },
    }),
    prisma.hallOfFameEntry.findMany({
      where: { entityType: 'MANAGER', entityId: managerId },
      select: { id: true, sport: true, inductedAt: true, score: true },
    }),
  ])

  for (const row of reputationRows) {
    const tier = row.tier.trim()
    if (!tier) continue
    allSeeds.push({
      managerId,
      sport: normalizeSportForGMCareer(row.sport),
      eventType: 'reputation_tier_up',
      valueChange: toEventValue(Number(row.overallScore ?? 0)),
      sourceReference: `reputation_tier_up:${row.id}:${tier}`,
      createdAt: row.updatedAt,
    })
  }

  for (const row of legacyRows) {
    const legacyScore = Number(row.overallLegacyScore ?? 0)
    if (legacyScore < 50) continue
    allSeeds.push({
      managerId,
      sport: normalizeSportForGMCareer(row.sport),
      eventType: 'legacy_milestone',
      valueChange: toEventValue(legacyScore),
      sourceReference: `legacy_milestone:${row.id}`,
      createdAt: row.updatedAt,
    })
  }

  for (const row of hallOfFameRows) {
    allSeeds.push({
      managerId,
      sport: normalizeSportForGMCareer(row.sport),
      eventType: 'hall_of_fame_induction',
      valueChange: toEventValue(Number(row.score ?? 0)),
      sourceReference: `hall_of_fame_induction:${row.id}`,
      createdAt: row.inductedAt,
    })
  }

  const uniqueByKey = new Map<string, ProgressionEventSeed>()
  for (const seed of allSeeds) {
    const key = `${seed.eventType}:${seed.sourceReference}`
    const existing = uniqueByKey.get(key)
    if (!existing || seed.createdAt < existing.createdAt) {
      uniqueByKey.set(key, seed)
    }
  }
  const dedupedSeeds = [...uniqueByKey.values()]
  if (dedupedSeeds.length === 0) return 0

  const existing = await prisma.gMProgressionEvent.findMany({
    where: {
      managerId,
      eventType: { in: [...GENERATED_EVENT_TYPES] },
      sourceReference: { not: null },
    },
    select: { eventType: true, sourceReference: true },
  })
  const existingKeys = new Set(existing.map((row) => `${row.eventType}:${row.sourceReference}`))
  const toCreate = dedupedSeeds.filter(
    (seed) => !existingKeys.has(`${seed.eventType}:${seed.sourceReference}`)
  )
  if (toCreate.length === 0) return 0

  await prisma.gMProgressionEvent.createMany({
    data: toCreate.map((seed) => ({
      managerId: seed.managerId,
      sport: seed.sport,
      eventType: seed.eventType,
      valueChange: seed.valueChange,
      sourceReference: seed.sourceReference,
      createdAt: seed.createdAt,
    })),
  })

  return toCreate.length
}

/**
 * Run the GM economy for one manager: aggregate career, upsert profile, append progression timeline events.
 */
export async function runGMEconomyForManager(managerId: string): Promise<GMEconomyRunResult | null> {
  const input = await aggregateCareerForManager(managerId)

  const existing = await prisma.managerFranchiseProfile.findUnique({
    where: { managerId },
  })

  const data = {
    managerId: input.managerId,
    totalCareerSeasons: input.totalCareerSeasons,
    totalLeaguesPlayed: input.totalLeaguesPlayed,
    championshipCount: input.championshipCount,
    playoffAppearances: input.playoffAppearances,
    careerWinPercentage: input.careerWinPercentage,
    gmPrestigeScore: input.gmPrestigeScore,
    franchiseValue: input.franchiseValue,
  }

  let profileId = existing?.id ?? null
  let created = false
  if (existing) {
    await prisma.managerFranchiseProfile.update({
      where: { id: existing.id },
      data,
    })
  } else {
    const createdProfile = await prisma.managerFranchiseProfile.create({
      data,
    })
    profileId = createdProfile.id
    created = true
  }

  const progressionEventsCreated = await createProgressionEventsForManager(managerId)
  if (!profileId) return null

  return {
    managerId,
    profileId,
    gmPrestigeScore: input.gmPrestigeScore,
    franchiseValue: input.franchiseValue,
    created,
    progressionEventsCreated,
  }
}

/**
 * Run GM economy for all managers that have at least one Roster (platform users).
 */
export async function runGMEconomyForAll(options?: {
  limit?: number
}): Promise<{ processed: number; created: number; updated: number; results: GMEconomyRunResult[] }> {
  const limit = options?.limit ?? 500
  const rosters = await prisma.roster.findMany({
    select: { platformUserId: true },
    take: limit * 2,
  })
  const managerIds = Array.from(new Set(rosters.map((r) => r.platformUserId))).slice(0, limit)

  let created = 0
  let updated = 0
  const results: GMEconomyRunResult[] = []

  for (const managerId of managerIds) {
    const r = await runGMEconomyForManager(managerId)
    if (r) {
      results.push(r)
      if (r.created) created++
      else updated++
    }
  }

  return {
    processed: results.length,
    created,
    updated,
    results,
  }
}
