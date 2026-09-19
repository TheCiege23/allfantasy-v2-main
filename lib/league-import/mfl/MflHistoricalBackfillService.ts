import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { buildLeagueGraph } from '@/lib/league-intelligence-graph'
import { rebuildHallOfFame } from '@/lib/rankings-engine/hall-of-fame'
import { normalizeSportForWarehouse } from '@/lib/data-warehouse/types'
import { persistDynastySeason, persistStandings } from '@/lib/dynasty-import/normalize-historical'
import { fetchMflLeagueForImport } from './MflLeagueFetchService'
import type {
  MflImportDraftPick,
  MflImportPayload,
  MflImportTeam,
  MflImportTransaction,
} from '@/lib/league-import/adapters/mfl/types'
import { persistProviderTransactionFacts } from '@/lib/league-import/persistProviderTransactionFacts'
import { persistSeasonStandingFacts } from '@/lib/league-import/bulkWarehouseFactPersistence'

const SEASON_END_ROSTER_SNAPSHOT_PERIOD = 0

interface MflSnapshotPlayer {
  id: string
  name: string | null
  position: string | null
  team: string | null
  bucket: 'starter' | 'bench'
  ownerId: string
  ownerName: string
  rosterId: string
}

export interface MflHistoricalBackfillSummary {
  attempted: boolean
  skipped: boolean
  reason?: string
  seasonsDiscovered?: number
  seasonsImported?: number
  standingsPersisted?: number
  rosterSnapshotsPersisted?: number
  matchupFactsPersisted?: number
  transactionFactsPersisted?: number
  draftFactsPersisted?: number
  graph?: {
    refreshed: boolean
    nodeCount?: number
    edgeCount?: number
    snapshotId?: string
    error?: string
  }
  hallOfFame?: {
    refreshed: boolean
    count?: number
    error?: string
  }
  error?: string
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return 'Unknown error'
}

function getSeasonFromPayload(payload: MflImportPayload): number | null {
  return payload.league.season ?? null
}

function buildMflSeasonMetadata(payload: MflImportPayload): Record<string, unknown> {
  return {
    sourceProvider: 'mfl',
    importedAt: new Date().toISOString(),
    leagueName: payload.league.name,
    leagueId: payload.league.leagueId,
    sport: payload.league.sport,
    season: payload.league.season,
    size: payload.league.size,
    currentWeek: payload.league.currentWeek,
    isFinished: payload.league.isFinished,
    playoffTeamCount: payload.league.playoffTeamCount,
    regularSeasonLength: payload.league.regularSeasonLength,
    leagueUrl: payload.league.url,
    scoringType: payload.settings?.scoringType ?? null,
    draftType: payload.settings?.draftType ?? null,
    rosterPositions: payload.settings?.rosterPositions ?? [],
    waiverSettings: {
      usesFaab: payload.settings?.usesFaab ?? null,
      acquisitionBudget: payload.settings?.acquisitionBudget ?? null,
      waiverType: payload.settings?.waiverType ?? null,
    },
    lineupBreakdownAvailable: payload.lineupBreakdownAvailable,
    previousSeasons: payload.previousSeasons,
    rawSettings: payload.settings?.raw ?? null,
  }
}

function buildSnapshotPlayers(team: MflImportTeam): MflSnapshotPlayer[] {
  const starterIds = new Set(team.starterPlayerIds)
  const reserveIds = new Set(team.reservePlayerIds)
  const allIds = new Set<string>([...team.rosterPlayerIds, ...team.starterPlayerIds, ...team.reservePlayerIds])

  return Array.from(allIds).map((playerId) => {
    const player = team.playerMap[playerId]
    return {
      id: playerId,
      name: player?.name ?? null,
      position: player?.position ?? null,
      team: player?.team ?? null,
      bucket: starterIds.has(playerId) ? 'starter' : reserveIds.has(playerId) ? 'bench' : 'bench',
      ownerId: team.managerId || team.franchiseId,
      ownerName: team.managerName,
      rosterId: team.franchiseId,
    }
  })
}

function inferChampionFromMflStandings(payload: MflImportPayload, team: MflImportTeam): boolean {
  if (!payload.league.isFinished) return false
  return team.rank === 1
}

function buildMflTransactionEntries(
  transaction: MflImportTransaction
): Array<{
  type: string
  playerId?: string
  rosterId?: string
  payload: Record<string, unknown>
  createdAt?: Date
}> {
  const entries: Array<{
    type: string
    playerId?: string
    rosterId?: string
    payload: Record<string, unknown>
    createdAt?: Date
  }> = []

  const createdAt = transaction.createdAt ? new Date(transaction.createdAt) : undefined
  for (const [playerId, rosterId] of Object.entries(transaction.adds)) {
    entries.push({
      type: transaction.type.includes('trade') ? 'trade' : transaction.type.includes('waiver') ? 'waiver_add' : 'add',
      playerId,
      rosterId,
      payload: {
        mflTransactionId: transaction.transactionId,
        status: transaction.status,
        franchiseIds: transaction.franchiseIds,
        direction: 'add',
      },
      createdAt,
    })
  }
  for (const [playerId, rosterId] of Object.entries(transaction.drops)) {
    entries.push({
      type: transaction.type.includes('trade') ? 'trade' : transaction.type.includes('waiver') ? 'waiver_drop' : 'drop',
      playerId,
      rosterId,
      payload: {
        mflTransactionId: transaction.transactionId,
        status: transaction.status,
        franchiseIds: transaction.franchiseIds,
        direction: 'drop',
      },
      createdAt,
    })
  }

  if (entries.length === 0) {
    entries.push({
      type: transaction.type || 'trade',
      payload: {
        mflTransactionId: transaction.transactionId,
        status: transaction.status,
        franchiseIds: transaction.franchiseIds,
      },
      createdAt,
    })
  }

  return entries
}

async function persistMflSeasonWarehouseFacts(args: {
  leagueId: string
  payload: MflImportPayload
}): Promise<{
  rosterSnapshotsPersisted: number
  matchupFactsPersisted: number
  transactionFactsPersisted: number
  draftFactsPersisted: number
}> {
  const season = getSeasonFromPayload(args.payload)
  const sport = normalizeSportForWarehouse(args.payload.league.sport)

  const snapshotCreates = args.payload.teams.map((team) => {
    const rosterPlayers = buildSnapshotPlayers(team)
    const lineupPlayers = rosterPlayers.filter((player) => player.bucket === 'starter')
    const benchPlayers = rosterPlayers.filter((player) => player.bucket !== 'starter')

    return prisma.rosterSnapshot.create({
      data: {
        leagueId: args.leagueId,
        teamId: team.franchiseId,
        sport,
        weekOrPeriod: SEASON_END_ROSTER_SNAPSHOT_PERIOD,
        season,
        rosterPlayers: rosterPlayers as unknown as Prisma.InputJsonValue,
        lineupPlayers: lineupPlayers as unknown as Prisma.InputJsonValue,
        benchPlayers: benchPlayers as unknown as Prisma.InputJsonValue,
      },
    })
  })

  const matchupCreates = args.payload.schedule.flatMap((week) =>
    week.matchups.map((matchup) =>
      prisma.matchupFact.create({
        data: {
          leagueId: args.leagueId,
          sport,
          weekOrPeriod: week.week,
          teamA: matchup.franchiseId1,
          teamB: matchup.franchiseId2,
          scoreA: matchup.points1 ?? 0,
          scoreB: matchup.points2 ?? 0,
          winnerTeamId:
            matchup.points1 != null && matchup.points2 != null && matchup.points1 !== matchup.points2
              ? matchup.points1 > matchup.points2
                ? matchup.franchiseId1
                : matchup.franchiseId2
              : null,
          season,
        },
      })
    )
  )

  const transactionRows = args.payload.transactions.flatMap((transaction) =>
    buildMflTransactionEntries(transaction).map((entry, entryIndex) => ({
      provider: 'mfl',
      upstreamTransactionId: transaction.transactionId,
      entryIndex,
      leagueId: args.leagueId,
      sport,
      type: entry.type,
      playerId: entry.playerId ?? null,
      managerId: entry.rosterId ?? null,
      rosterId: entry.rosterId ?? null,
      payload: entry.payload,
      season,
      weekOrPeriod: null,
      occurredAt: entry.createdAt,
    }))
  )

  const draftRows = args.payload.draftPicks
  const draftCreates = draftRows.map((pick: MflImportDraftPick) =>
    prisma.draftFact.create({
      data: {
        leagueId: args.leagueId,
        sport,
        round: pick.round,
        pickNumber: pick.pickNumber,
        playerId: pick.playerId,
        managerId: pick.franchiseId,
        season,
      },
    })
  )

  await prisma.$transaction([
    prisma.rosterSnapshot.deleteMany({
      where: {
        leagueId: args.leagueId,
        season,
        weekOrPeriod: SEASON_END_ROSTER_SNAPSHOT_PERIOD,
      },
    }),
    prisma.matchupFact.deleteMany({
      where: {
        leagueId: args.leagueId,
        season,
      },
    }),
    prisma.draftFact.deleteMany({
      where: {
        leagueId: args.leagueId,
        season,
      },
    }),
    ...snapshotCreates,
    ...matchupCreates,
    ...draftCreates,
  ])
  const transactionFactsPersisted = await persistProviderTransactionFacts(transactionRows)

  return {
    rosterSnapshotsPersisted: snapshotCreates.length,
    matchupFactsPersisted: matchupCreates.length,
    transactionFactsPersisted,
    draftFactsPersisted: draftCreates.length,
  }
}

export async function syncMflHistoricalBackfillAfterImport(args: {
  leagueId: string
  userId: string
}): Promise<MflHistoricalBackfillSummary> {
  const league = await prisma.league.findUnique({
    where: { id: args.leagueId },
    select: {
      id: true,
      platform: true,
      platformLeagueId: true,
      season: true,
    },
  })

  if (!league) {
    return {
      attempted: false,
      skipped: true,
      reason: 'League not found.',
    }
  }

  if (league.platform !== 'mfl' || !league.platformLeagueId) {
    return {
      attempted: false,
      skipped: true,
      reason: 'MFL historical backfill only applies to MFL leagues with a platformLeagueId.',
    }
  }

  try {
    const currentSourceInput = league.season ? `${league.season}:${league.platformLeagueId}` : league.platformLeagueId
    const currentPayload = await fetchMflLeagueForImport(args.userId, currentSourceInput, {
      includePreviousSeasons: true,
      maxPreviousSeasons: 8,
    })
    const additionalPayloads = await Promise.all(
      currentPayload.previousSeasons.map((season) =>
        fetchMflLeagueForImport(args.userId, `${season.season}:${season.sourceLeagueId}`, {
          includePreviousSeasons: false,
        })
      )
    )

    const payloads = [currentPayload, ...additionalPayloads]
      .filter((payload) => payload.league.season != null)
      .sort((a, b) => (getSeasonFromPayload(b) ?? 0) - (getSeasonFromPayload(a) ?? 0))

    const dedupedPayloads = new Map<number, MflImportPayload>()
    for (const payload of payloads) {
      const season = getSeasonFromPayload(payload)
      if (season == null || dedupedPayloads.has(season)) continue
      dedupedPayloads.set(season, payload)
    }

    if (dedupedPayloads.size === 0) {
      return {
        attempted: true,
        skipped: true,
        reason: 'No MFL seasons were available to backfill.',
        seasonsDiscovered: 0,
        seasonsImported: 0,
      }
    }

    let seasonsImported = 0
    let standingsPersisted = 0
    let rosterSnapshotsPersisted = 0
    let matchupFactsPersisted = 0
    let transactionFactsPersisted = 0
    let draftFactsPersisted = 0

    for (const payload of dedupedPayloads.values()) {
      const season = getSeasonFromPayload(payload)
      if (season == null) continue

      await persistDynastySeason(
        args.leagueId,
        season,
        payload.league.leagueId,
        'mfl',
        buildMflSeasonMetadata(payload)
      )

      const finishedSeasonRows = payload.league.isFinished
        ? payload.teams.map((team) => ({
            rosterId: team.managerId || team.franchiseId,
            wins: team.wins,
            losses: team.losses,
            pointsFor: team.pointsFor,
            pointsAgainst: team.pointsAgainst ?? 0,
            champion: inferChampionFromMflStandings(payload, team),
          }))
        : []

      if (finishedSeasonRows.length > 0) {
        await persistStandings(args.leagueId, season, finishedSeasonRows)
        standingsPersisted += finishedSeasonRows.length
      }

      await persistSeasonStandingFacts(payload.teams.map((team) => ({
            leagueId: args.leagueId,
            sport: normalizeSportForWarehouse(payload.league.sport),
            season,
            teamId: team.franchiseId,
            wins: team.wins,
            losses: team.losses,
            ties: team.ties,
            pointsFor: team.pointsFor,
            pointsAgainst: team.pointsAgainst ?? 0,
            rank: team.rank ?? null,
      })))

      const warehouse = await persistMflSeasonWarehouseFacts({
        leagueId: args.leagueId,
        payload,
      })

      rosterSnapshotsPersisted += warehouse.rosterSnapshotsPersisted
      matchupFactsPersisted += warehouse.matchupFactsPersisted
      transactionFactsPersisted += warehouse.transactionFactsPersisted
      draftFactsPersisted += warehouse.draftFactsPersisted
      seasonsImported += 1
    }

    const summary: MflHistoricalBackfillSummary = {
      attempted: true,
      skipped: false,
      seasonsDiscovered: dedupedPayloads.size,
      seasonsImported,
      standingsPersisted,
      rosterSnapshotsPersisted,
      matchupFactsPersisted,
      transactionFactsPersisted,
      draftFactsPersisted,
    }

    try {
      const graph = await buildLeagueGraph({
        leagueId: args.leagueId,
        season: null,
        includeTrades: true,
        includeRivalries: true,
      })
      summary.graph = {
        refreshed: true,
        nodeCount: graph.nodeCount,
        edgeCount: graph.edgeCount,
        snapshotId: graph.snapshotId,
      }
    } catch (error) {
      summary.graph = {
        refreshed: false,
        error: getErrorMessage(error),
      }
    }

    try {
      const hallOfFame = await rebuildHallOfFame({ leagueId: args.leagueId })
      summary.hallOfFame = {
        refreshed: true,
        count: hallOfFame.count,
      }
    } catch (error) {
      summary.hallOfFame = {
        refreshed: false,
        error: getErrorMessage(error),
      }
    }

    return summary
  } catch (error) {
    return {
      attempted: true,
      skipped: false,
      error: getErrorMessage(error),
      graph: {
        refreshed: false,
      },
      hallOfFame: {
        refreshed: false,
      },
    }
  }
}
