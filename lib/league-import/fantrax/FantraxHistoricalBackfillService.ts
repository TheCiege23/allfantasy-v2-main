import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { buildLeagueGraph } from '@/lib/league-intelligence-graph'
import { rebuildHallOfFame } from '@/lib/rankings-engine/hall-of-fame'
import { normalizeSportForWarehouse } from '@/lib/data-warehouse/types'
import { persistDynastySeason, persistStandings } from '@/lib/dynasty-import/normalize-historical'
import { fetchFantraxLeagueForImport } from './FantraxLeagueFetchService'
import type {
  FantraxImportDraftPick,
  FantraxImportPayload,
  FantraxImportTeam,
  FantraxImportTransaction,
} from '@/lib/league-import/adapters/fantrax/types'
import { persistProviderTransactionFacts } from '@/lib/league-import/persistProviderTransactionFacts'

const SEASON_END_ROSTER_SNAPSHOT_PERIOD = 0

interface FantraxSnapshotPlayer {
  id: string
  name: string | null
  position: string | null
  team: string | null
  bucket: 'starter' | 'bench'
  ownerId: string
  ownerName: string
  rosterId: string
}

export interface FantraxHistoricalBackfillSummary {
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

function getSeasonFromPayload(payload: FantraxImportPayload): number | null {
  return payload.league.season ?? null
}

function buildFantraxSeasonMetadata(payload: FantraxImportPayload): Record<string, unknown> {
  return {
    sourceProvider: 'fantrax',
    importedAt: new Date().toISOString(),
    leagueName: payload.league.name,
    leagueId: payload.league.leagueId,
    sport: payload.league.sport,
    season: payload.league.season,
    size: payload.league.size,
    currentWeek: payload.league.currentWeek,
    isFinished: payload.league.isFinished,
    isDevy: payload.league.isDevy,
    settings: payload.settings,
    previousSeasons: payload.previousSeasons,
  }
}

function buildSnapshotPlayers(
  team: FantraxImportTeam,
  globalPlayerMap: FantraxImportPayload['playerMap']
): FantraxSnapshotPlayer[] {
  const starterIds = new Set(team.starterPlayerIds)
  const reserveIds = new Set(team.reservePlayerIds)
  const allIds = new Set<string>([...team.rosterPlayerIds, ...team.starterPlayerIds, ...team.reservePlayerIds])

  return Array.from(allIds).map((playerId) => {
    const player = team.playerMap[playerId] ?? globalPlayerMap[playerId]
    return {
      id: playerId,
      name: player?.name ?? null,
      position: player?.position ?? null,
      team: player?.team ?? null,
      bucket: starterIds.has(playerId) ? 'starter' : reserveIds.has(playerId) ? 'bench' : 'bench',
      ownerId: team.managerId || team.teamId,
      ownerName: team.managerName,
      rosterId: team.teamId,
    }
  })
}

function inferChampionFromFantraxStandings(
  payload: FantraxImportPayload,
  team: FantraxImportTeam
): boolean {
  if (!payload.league.isFinished) return false
  return team.rank === 1
}

function parseTransactionCreatedAt(
  transaction: FantraxImportTransaction
): Date | undefined {
  if (!transaction.createdAt) return undefined
  const parsed = new Date(transaction.createdAt)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed
}

function buildFantraxTransactionEntries(
  transaction: FantraxImportTransaction
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

  const createdAt = parseTransactionCreatedAt(transaction)
  for (const [playerId, rosterId] of Object.entries(transaction.adds)) {
    entries.push({
      type:
        transaction.type === 'trade'
          ? 'trade'
          : transaction.type === 'waiver'
            ? 'waiver_add'
            : 'add',
      playerId,
      rosterId,
      payload: {
        fantraxTransactionId: transaction.transactionId,
        status: transaction.status,
        teamIds: transaction.teamIds,
        direction: 'add',
      },
      createdAt,
    })
  }
  for (const [playerId, rosterId] of Object.entries(transaction.drops)) {
    entries.push({
      type:
        transaction.type === 'trade'
          ? 'trade'
          : transaction.type === 'waiver'
            ? 'waiver_drop'
            : 'drop',
      playerId,
      rosterId,
      payload: {
        fantraxTransactionId: transaction.transactionId,
        status: transaction.status,
        teamIds: transaction.teamIds,
        direction: 'drop',
      },
      createdAt,
    })
  }

  if (entries.length === 0) {
    entries.push({
      type: transaction.type || 'trade',
      payload: {
        fantraxTransactionId: transaction.transactionId,
        status: transaction.status,
        teamIds: transaction.teamIds,
      },
      createdAt,
    })
  }

  return entries
}

async function persistFantraxSeasonWarehouseFacts(args: {
  leagueId: string
  payload: FantraxImportPayload
}): Promise<{
  rosterSnapshotsPersisted: number
  matchupFactsPersisted: number
  transactionFactsPersisted: number
  draftFactsPersisted: number
}> {
  const season = getSeasonFromPayload(args.payload)
  const sport = normalizeSportForWarehouse(args.payload.league.sport)

  const snapshotCreates = args.payload.teams.map((team) => {
    const rosterPlayers = buildSnapshotPlayers(team, args.payload.playerMap)
    const lineupPlayers = rosterPlayers.filter((player) => player.bucket === 'starter')
    const benchPlayers = rosterPlayers.filter((player) => player.bucket !== 'starter')

    return prisma.rosterSnapshot.create({
      data: {
        leagueId: args.leagueId,
        teamId: team.teamId,
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
          teamA: matchup.teamId1,
          teamB: matchup.teamId2,
          scoreA: matchup.points1 ?? 0,
          scoreB: matchup.points2 ?? 0,
          winnerTeamId:
            matchup.points1 != null && matchup.points2 != null && matchup.points1 !== matchup.points2
              ? matchup.points1 > matchup.points2
                ? matchup.teamId1
                : matchup.teamId2
              : null,
          season,
        },
      })
    )
  )

  const transactionRows = args.payload.transactions.flatMap((transaction) =>
    buildFantraxTransactionEntries(transaction).map((entry, entryIndex) => ({
      provider: 'fantrax',
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
  const draftCreates = draftRows.map((pick: FantraxImportDraftPick) =>
    prisma.draftFact.create({
      data: {
        leagueId: args.leagueId,
        sport,
        round: pick.round,
        pickNumber: pick.pickNumber,
        playerId: pick.playerId,
        managerId: pick.teamId,
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

export async function syncFantraxHistoricalBackfillAfterImport(args: {
  leagueId: string
  userId: string
}): Promise<FantraxHistoricalBackfillSummary> {
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

  if (league.platform !== 'fantrax' || !league.platformLeagueId) {
    return {
      attempted: false,
      skipped: true,
      reason: 'Fantrax historical backfill only applies to Fantrax leagues with a platformLeagueId.',
    }
  }

  try {
    const currentPayload = await fetchFantraxLeagueForImport(
      args.userId,
      `id:${league.platformLeagueId}`
    )
    const additionalPayloadResults = await Promise.allSettled(
      currentPayload.previousSeasons.map((season) =>
        fetchFantraxLeagueForImport(args.userId, `id:${season.sourceLeagueId}`)
      )
    )
    const additionalPayloads = additionalPayloadResults
      .filter(
        (result): result is PromiseFulfilledResult<FantraxImportPayload> =>
          result.status === 'fulfilled'
      )
      .map((result) => result.value)

    const payloads = [currentPayload, ...additionalPayloads]
      .filter((payload) => payload.league.season != null)
      .sort((a, b) => (getSeasonFromPayload(b) ?? 0) - (getSeasonFromPayload(a) ?? 0))

    const dedupedPayloads = new Map<number, FantraxImportPayload>()
    for (const payload of payloads) {
      const season = getSeasonFromPayload(payload)
      if (season == null || dedupedPayloads.has(season)) continue
      dedupedPayloads.set(season, payload)
    }

    if (dedupedPayloads.size === 0) {
      return {
        attempted: true,
        skipped: true,
        reason: 'No Fantrax seasons were available to backfill.',
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
        'fantrax',
        buildFantraxSeasonMetadata(payload)
      )

      const finishedSeasonRows = payload.league.isFinished
        ? payload.teams.map((team) => ({
            rosterId: team.managerId || team.teamId,
            wins: team.wins,
            losses: team.losses,
            pointsFor: team.pointsFor,
            pointsAgainst: team.pointsAgainst ?? 0,
            champion: inferChampionFromFantraxStandings(payload, team),
          }))
        : []

      if (finishedSeasonRows.length > 0) {
        await persistStandings(args.leagueId, season, finishedSeasonRows)
        standingsPersisted += finishedSeasonRows.length
      }

      for (const team of payload.teams) {
        await prisma.seasonStandingFact.upsert({
          where: {
            uniq_dw_standing_league_season_team: {
              leagueId: args.leagueId,
              season,
              teamId: team.teamId,
            },
          },
          create: {
            leagueId: args.leagueId,
            sport: normalizeSportForWarehouse(payload.league.sport),
            season,
            teamId: team.teamId,
            wins: team.wins,
            losses: team.losses,
            ties: team.ties,
            pointsFor: team.pointsFor,
            pointsAgainst: team.pointsAgainst ?? 0,
            rank: team.rank ?? null,
          },
          update: {
            wins: team.wins,
            losses: team.losses,
            ties: team.ties,
            pointsFor: team.pointsFor,
            pointsAgainst: team.pointsAgainst ?? 0,
            rank: team.rank ?? null,
          },
        })
      }

      const warehouse = await persistFantraxSeasonWarehouseFacts({
        leagueId: args.leagueId,
        payload,
      })

      rosterSnapshotsPersisted += warehouse.rosterSnapshotsPersisted
      matchupFactsPersisted += warehouse.matchupFactsPersisted
      transactionFactsPersisted += warehouse.transactionFactsPersisted
      draftFactsPersisted += warehouse.draftFactsPersisted
      seasonsImported += 1
    }

    const summary: FantraxHistoricalBackfillSummary = {
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
