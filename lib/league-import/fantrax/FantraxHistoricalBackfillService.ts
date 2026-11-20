import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { refreshHistoricalDerivedData } from '@/lib/league-import/refreshHistoricalDerivedData'
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
import { persistSeasonStandingFacts } from '@/lib/league-import/bulkWarehouseFactPersistence'

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

/**
 * The team that won the league, or null when it cannot be said.
 *
 * 🛑 RANK 1 IS THE TOP OF THE STANDINGS TABLE, NOT THE CHAMPION. This used to
 * crown whoever held rank 1, so a top seed that lost in the semi-final was
 * recorded as that season's winner. When the league ran playoffs and their
 * results are on file, the champion is read from those results instead.
 *
 * The rule: the champion WON a matchup in the last scored playoff week and LOST
 * none in any playoff week. A third-place game is won by a team that already lost
 * its semi-final, so it drops out.
 *
 * ⚠ A CONSOLATION BRACKET CAN PRODUCE A SECOND UNBEATEN TEAM. `isPlayoff` is set
 * per WEEK, so games between teams that missed the playoffs carry it too, and the
 * winner of that bracket never lost a "playoff" game either. Those teams sit
 * below every playoff qualifier in the standings, so the best-ranked candidate is
 * the title-bracket one. If the candidates cannot be separated by rank, nobody is
 * crowned.
 *
 * ⚠ RANK 1 IS STILL THE ANSWER WHEN THERE WERE NO PLAYOFFS (rotisserie, season-
 * long points, or playoffs switched off), and the fallback when no playoff week
 * has a score on file.
 */
export function resolveFantraxChampionTeamId(payload: FantraxImportPayload): string | null {
  if (!payload.league.isFinished) return null
  const raw = payload.settings?.raw
  const playoffs = raw?.playoffs as { used?: boolean } | undefined

  const lost = new Set<string>()
  let lastScoredPlayoffWeek: number | null = null
  let lastWeekWinners: string[] = []

  for (const week of [...payload.schedule].sort((a, b) => a.week - b.week)) {
    const winners: string[] = []
    for (const matchup of week.matchups) {
      if (!matchup.isPlayoff) continue
      if (matchup.points1 == null || matchup.points2 == null) continue
      if (matchup.points1 === matchup.points2 && !matchup.tiebreakWinnerId) continue
      const firstWon = matchup.points1 === matchup.points2 ? matchup.tiebreakWinnerId === matchup.teamId1 : matchup.points1 > matchup.points2
      winners.push(firstWon ? matchup.teamId1 : matchup.teamId2)
      lost.add(firstWon ? matchup.teamId2 : matchup.teamId1)
    }
    if (winners.length > 0) {
      lastScoredPlayoffWeek = week.week
      lastWeekWinners = winners
    }
  }

  if (playoffs?.used && (lastScoredPlayoffWeek == null ||
    (typeof raw?.lastPeriod === 'number' && lastScoredPlayoffWeek < raw.lastPeriod))) return null
  if (lastScoredPlayoffWeek == null) {
    return payload.teams.find((team) => team.rank === 1)?.teamId ?? null
  }

  const candidates = lastWeekWinners.filter((teamId) => !lost.has(teamId))
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]!

  const rankOf = (teamId: string) =>
    payload.teams.find((team) => team.teamId === teamId)?.rank ?? null
  const ranked = candidates
    .map((teamId) => ({ teamId, rank: rankOf(teamId) }))
    .filter((entry): entry is { teamId: string; rank: number } => entry.rank != null)
    .sort((a, b) => a.rank - b.rank)
  if (ranked.length !== candidates.length) return null
  if (ranked[0]!.rank === ranked[1]!.rank) return null
  return ranked[0]!.teamId
}

type FantraxScheduleMatchup = FantraxImportPayload['schedule'][number]['matchups'][number]

/** The matchups that have a result on file — both scores present. */
export function scoredFantraxMatchups(payload: FantraxImportPayload): Array<{
  week: number
  matchup: FantraxScheduleMatchup & { points1: number; points2: number }
}> {
  const calendar = payload.settings?.raw?.scoringPeriods
  const openPeriods = new Set<number>()
  if (Array.isArray(calendar)) {
    const now = Date.now()
    for (const period of calendar) {
      if (period && Date.parse(period.endDate) >= now) openPeriods.add(period.number)
    }
  }
  return payload.schedule.filter((week) => !openPeriods.has(week.week)).flatMap((week) =>
    week.matchups.flatMap((matchup) =>
      matchup.points1 != null && matchup.points2 != null
        ? [{ week: week.week, matchup: { ...matchup, points1: matchup.points1, points2: matchup.points2 } }]
        : [],
    ),
  )
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

  /*
   * 🛑 AN UNPLAYED MATCHUP IS NOT WRITTEN AT ALL. `scoreA`/`scoreB` are
   * non-nullable, and this defaulted a missing score to 0 — so every week Fantrax
   * had not scored yet landed in the warehouse as a 0-0 tie, indistinguishable
   * from a real one. The import keeps those scores null on purpose; a fact row is
   * a result, and a fixture with no result is not one.
   */
  const matchupCreates = scoredFantraxMatchups(args.payload).map(({ week, matchup }) =>
    prisma.matchupFact.create({
      data: {
        leagueId: args.leagueId,
        sport,
        weekOrPeriod: week,
        teamA: matchup.teamId1,
        teamB: matchup.teamId2,
        scoreA: matchup.points1,
        scoreB: matchup.points2,
        winnerTeamId:
          matchup.points1 !== matchup.points2
            ? matchup.points1 > matchup.points2
              ? matchup.teamId1
              : matchup.teamId2
            : matchup.tiebreakWinnerId ?? null,
        season,
      },
    })
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

      const championTeamId = resolveFantraxChampionTeamId(payload)
      const finishedSeasonRows = payload.league.isFinished
        ? payload.teams.map((team) => ({
            rosterId: team.managerId || team.teamId,
            wins: team.wins,
            losses: team.losses,
            pointsFor: team.pointsFor,
            pointsAgainst: team.pointsAgainst ?? 0,
            champion: championTeamId != null && team.teamId === championTeamId,
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
            teamId: team.teamId,
            wins: team.wins,
            losses: team.losses,
            ties: team.ties,
            pointsFor: team.pointsFor,
            pointsAgainst: team.pointsAgainst ?? 0,
            rank: team.rank ?? null,
      })))

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
