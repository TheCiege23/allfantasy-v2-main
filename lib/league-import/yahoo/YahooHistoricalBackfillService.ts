import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { refreshHistoricalDerivedData } from '@/lib/league-import/refreshHistoricalDerivedData'
import { persistDynastySeason, persistStandings } from '@/lib/dynasty-import/normalize-historical'
import { fetchYahooLeagueForImport } from './YahooLeagueFetchService'
import type { YahooImportPayload, YahooImportTeam } from '@/lib/league-import/adapters/yahoo/types'
import { persistProviderTransactionFacts } from '@/lib/league-import/persistProviderTransactionFacts'
import { persistSeasonStandingFacts } from '@/lib/league-import/bulkWarehouseFactPersistence'

const SEASON_END_ROSTER_SNAPSHOT_PERIOD = 0

interface YahooSnapshotPlayer {
  id: string
  name: string | null
  position: string | null
  team: string | null
  bucket: 'starter' | 'bench'
  ownerId: string
  ownerName: string
  rosterId: string
}

export interface YahooHistoricalBackfillSummary {
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

function getSeasonFromPayload(payload: YahooImportPayload): number | null {
  return payload.league.season ?? null
}

function buildYahooSeasonMetadata(payload: YahooImportPayload): Record<string, unknown> {
  return {
    sourceProvider: 'yahoo',
    importedAt: new Date().toISOString(),
    leagueName: payload.league.name,
    leagueKey: payload.league.leagueKey,
    sport: payload.league.sport,
    season: payload.league.season,
    numTeams: payload.league.numTeams,
    draftStatus: payload.league.draftStatus,
    currentWeek: payload.league.currentWeek,
    startWeek: payload.league.startWeek,
    endWeek: payload.league.endWeek,
    isFinished: payload.league.isFinished,
    scoringSettings: payload.settings?.statModifiers ?? [],
    statCategories: payload.settings?.statCategories ?? [],
    rosterPositions: payload.settings?.rosterPositions ?? [],
    playoffSettings: {
      usesPlayoff: payload.settings?.usesPlayoff ?? null,
      playoffStartWeek: payload.settings?.playoffStartWeek ?? null,
      usesPlayoffReseeding: payload.settings?.usesPlayoffReseeding ?? null,
      usesLockEliminatedTeams: payload.settings?.usesLockEliminatedTeams ?? null,
    },
    scheduleWeeksExpected: payload.scheduleWeeksExpected,
    scheduleWeeksCovered: payload.scheduleWeeksCovered,
    draftResultsCount: payload.draftPicks.length,
    previousSeasons: payload.previousSeasons,
    rawSettings: payload.settings?.raw ?? null,
  }
}

function buildSnapshotPlayers(team: YahooImportTeam): YahooSnapshotPlayer[] {
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
      ownerId: team.managerGuid || team.managerId || team.teamKey,
      ownerName: team.managerName,
      rosterId: team.teamKey,
    }
  })
}

function inferChampionFromYahooStandings(payload: YahooImportPayload, team: YahooImportTeam): boolean {
  if (!payload.league.isFinished) return false
  return team.rank === 1
}

async function persistYahooSeasonWarehouseFacts(args: {
  leagueId: string
  payload: YahooImportPayload
}): Promise<{
  rosterSnapshotsPersisted: number
  matchupFactsPersisted: number
  transactionFactsPersisted: number
  draftFactsPersisted: number
}> {
  const season = getSeasonFromPayload(args.payload)
  const snapshotCreates = args.payload.teams.map((team) => {
    const rosterPlayers = buildSnapshotPlayers(team)
    const lineupPlayers = rosterPlayers.filter((player) => player.bucket === 'starter')
    const benchPlayers = rosterPlayers.filter((player) => player.bucket !== 'starter')

    return prisma.rosterSnapshot.create({
      data: {
        leagueId: args.leagueId,
        teamId: team.teamKey,
        sport: args.payload.league.sport,
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
          sport: args.payload.league.sport,
          weekOrPeriod: week.week,
          teamA: matchup.teamKey1,
          teamB: matchup.teamKey2,
          scoreA: matchup.points1 ?? 0,
          scoreB: matchup.points2 ?? 0,
          winnerTeamId:
            matchup.points1 != null && matchup.points2 != null && matchup.points1 !== matchup.points2
              ? matchup.points1 > matchup.points2
                ? matchup.teamKey1
                : matchup.teamKey2
              : null,
          season,
        },
      })
    )
  )

  const transactionRows = args.payload.transactions.flatMap((transaction) => {
    const entries: Array<{
      type: string
      playerId?: string
      managerId?: string
      rosterId?: string
      payload: Record<string, unknown>
      createdAt?: Date
    }> = []

    const createdAt = transaction.createdAt ? new Date(transaction.createdAt) : undefined
    for (const [playerId, rosterId] of Object.entries(transaction.adds)) {
      entries.push({
        type: transaction.type === 'trade' ? 'trade' : 'add',
        playerId,
        managerId: undefined,
        rosterId,
        payload: {
          yahooTransactionId: transaction.transactionId,
          status: transaction.status,
          teamKeys: transaction.teamKeys,
          direction: 'add',
        },
        createdAt,
      })
    }
    for (const [playerId, rosterId] of Object.entries(transaction.drops)) {
      entries.push({
        type: transaction.type === 'trade' ? 'trade' : 'drop',
        playerId,
        managerId: undefined,
        rosterId,
        payload: {
          yahooTransactionId: transaction.transactionId,
          status: transaction.status,
          teamKeys: transaction.teamKeys,
          direction: 'drop',
        },
        createdAt,
      })
    }

    if (entries.length === 0) {
      entries.push({
        type: transaction.type,
        payload: {
          yahooTransactionId: transaction.transactionId,
          status: transaction.status,
          teamKeys: transaction.teamKeys,
        },
        createdAt,
      })
    }

    return entries.map((entry, entryIndex) => ({
      provider: 'yahoo',
      upstreamTransactionId: transaction.transactionId,
      entryIndex,
      leagueId: args.leagueId,
      sport: args.payload.league.sport,
      type: entry.type,
      playerId: entry.playerId ?? null,
      managerId: entry.managerId ?? null,
      rosterId: entry.rosterId ?? null,
      payload: entry.payload,
      season,
      weekOrPeriod: null,
      occurredAt: entry.createdAt,
    }))
  })

  const draftCreates = args.payload.draftPicks.map((pick) =>
    prisma.draftFact.create({
      data: {
        leagueId: args.leagueId,
        sport: args.payload.league.sport,
        round: pick.round,
        pickNumber: pick.pickNumber,
        playerId: pick.playerId,
        managerId: pick.teamKey,
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

export async function syncYahooHistoricalBackfillAfterImport(args: {
  leagueId: string
  userId: string
}): Promise<YahooHistoricalBackfillSummary> {
  const league = await prisma.league.findUnique({
    where: { id: args.leagueId },
    select: {
      id: true,
      platform: true,
      platformLeagueId: true,
    },
  })

  if (!league) {
    return {
      attempted: false,
      skipped: true,
      reason: 'League not found.',
    }
  }

  if (league.platform !== 'yahoo' || !league.platformLeagueId) {
    return {
      attempted: false,
      skipped: true,
      reason: 'Yahoo historical backfill only applies to Yahoo leagues with a platformLeagueId.',
    }
  }

  try {
    const currentPayload = await fetchYahooLeagueForImport(args.userId, league.platformLeagueId)
    const additionalPayloads = await Promise.all(
      currentPayload.previousSeasons.map((season) => fetchYahooLeagueForImport(args.userId, season.sourceLeagueId))
    )

    const payloads = [currentPayload, ...additionalPayloads]
      .filter((payload) => payload.league.season != null)
      .sort((a, b) => (getSeasonFromPayload(b) ?? 0) - (getSeasonFromPayload(a) ?? 0))

    const dedupedPayloads = new Map<number, YahooImportPayload>()
    for (const payload of payloads) {
      const season = getSeasonFromPayload(payload)
      if (season == null || dedupedPayloads.has(season)) continue
      dedupedPayloads.set(season, payload)
    }

    if (dedupedPayloads.size === 0) {
      return {
        attempted: true,
        skipped: true,
        reason: 'No Yahoo seasons were available to backfill.',
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
        payload.league.leagueKey,
        'yahoo',
        buildYahooSeasonMetadata(payload)
      )

      const finishedSeasonRows = payload.league.isFinished
        ? payload.teams.map((team) => ({
            rosterId: team.managerGuid || team.managerId || team.teamKey,
            wins: team.wins,
            losses: team.losses,
            pointsFor: team.pointsFor,
            pointsAgainst: team.pointsAgainst ?? 0,
            champion: inferChampionFromYahooStandings(payload, team),
          }))
        : []

      if (finishedSeasonRows.length > 0) {
        await persistStandings(args.leagueId, season, finishedSeasonRows)
        standingsPersisted += finishedSeasonRows.length
      }

      await persistSeasonStandingFacts(payload.teams.map((team) => ({
            leagueId: args.leagueId,
            sport: payload.league.sport,
            season,
            teamId: team.teamKey,
            wins: team.wins,
            losses: team.losses,
            ties: team.ties,
            pointsFor: team.pointsFor,
            pointsAgainst: team.pointsAgainst ?? 0,
            rank: team.rank ?? null,
      })))

      const warehouse = await persistYahooSeasonWarehouseFacts({
        leagueId: args.leagueId,
        payload,
      })

      rosterSnapshotsPersisted += warehouse.rosterSnapshotsPersisted
      matchupFactsPersisted += warehouse.matchupFactsPersisted
      transactionFactsPersisted += warehouse.transactionFactsPersisted
      draftFactsPersisted += warehouse.draftFactsPersisted
      seasonsImported += 1
    }

    const summary: YahooHistoricalBackfillSummary = {
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

    const derived = await refreshHistoricalDerivedData({ leagueId: args.leagueId })
    summary.graph = derived.graph
    summary.hallOfFame = derived.hallOfFame

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
