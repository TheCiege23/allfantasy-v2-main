/**
 * AnalyticsQueryLayer (PROMPT 138) unified query API over the fantasy data warehouse.
 * Query player stats, league results, draft logs, trade logs, simulation outputs, and snapshots.
 */

import { prisma } from '@/lib/prisma'
import { normalizeSportForWarehouse } from './types'
import type {
  WarehouseActivityEntry,
  WarehouseDatasetCounts,
  WarehouseDatasetLatest,
  WarehouseOverview,
  WarehouseSimulationAnalytics,
} from './types'
import {
  getLeagueHistorySummary,
  getMatchupHistory,
  getStandingsHistory,
  getRosterSnapshotsForTeam,
  getPlayerGameFactsForPlayer,
  getDraftHistoryForLeague,
  getTransactionHistoryForLeague,
  type LeagueHistorySummary,
} from './LeagueHistoryAggregator'
import {
  getPlayerFantasyPointsByPeriod,
  getTeamPointsByPeriodForLeague,
  getStandingsBySeasonForLeague,
  getTransactionVolumeByLeague,
  getLeagueWarehouseSummaryForAI,
} from './WarehouseQueryService'

export type { LeagueHistorySummary }

function roundTo(value: number, digits = 2): number {
  return Number(value.toFixed(digits))
}

function resolveLatestActivity(latestByDataset: WarehouseDatasetLatest): string | null {
  const latestValues = Object.values(latestByDataset).filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  )
  if (latestValues.length === 0) return null
  return latestValues.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null
}

export function buildWarehouseOverview(args: {
  leagueId?: string | null
  sport?: string | null
  season?: number
  counts: WarehouseDatasetCounts
  latestByDataset: WarehouseDatasetLatest
}): WarehouseOverview {
  const totalRecords = Object.values(args.counts).reduce((sum, count) => sum + count, 0)
  const populatedDatasets = Object.values(args.counts).filter((count) => count > 0).length
  const coveragePct = roundTo((populatedDatasets / Object.keys(args.counts).length) * 100, 1)

  return {
    leagueId: args.leagueId ?? null,
    sport: args.sport ? normalizeSportForWarehouse(args.sport) : null,
    season: args.season,
    totalRecords,
    coveragePct,
    latestActivityAt: resolveLatestActivity(args.latestByDataset),
    counts: args.counts,
    latestByDataset: args.latestByDataset,
  }
}

export function buildWarehouseActivityFeed(
  entries: WarehouseActivityEntry[],
  limit: number = 25
): WarehouseActivityEntry[] {
  return [...entries]
    .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
    .slice(0, Math.max(1, limit))
}

export function buildWarehouseSimulationAnalytics(args: {
  matchupSimulations: Array<{
    expectedScoreA: number
    expectedScoreB: number
    winProbabilityA: number
  }>
  seasonSimulations: Array<{
    teamId: string
    playoffProbability: number
    championshipProbability: number
  }>
}): WarehouseSimulationAnalytics {
  const matchupSimulationCount = args.matchupSimulations.length
  const seasonSimulationCount = args.seasonSimulations.length

  const averageExpectedScoreA =
    matchupSimulationCount > 0
      ? roundTo(
          args.matchupSimulations.reduce((sum, simulation) => sum + simulation.expectedScoreA, 0) /
            matchupSimulationCount,
          2
        )
      : null
  const averageExpectedScoreB =
    matchupSimulationCount > 0
      ? roundTo(
          args.matchupSimulations.reduce((sum, simulation) => sum + simulation.expectedScoreB, 0) /
            matchupSimulationCount,
          2
        )
      : null
  const averageWinProbabilityA =
    matchupSimulationCount > 0
      ? roundTo(
          args.matchupSimulations.reduce((sum, simulation) => sum + simulation.winProbabilityA, 0) /
            matchupSimulationCount,
          4
        )
      : null

  const averagePlayoffProbability =
    seasonSimulationCount > 0
      ? roundTo(
          args.seasonSimulations.reduce((sum, simulation) => sum + simulation.playoffProbability, 0) /
            seasonSimulationCount,
          4
        )
      : null
  const averageChampionshipProbability =
    seasonSimulationCount > 0
      ? roundTo(
          args.seasonSimulations.reduce(
            (sum, simulation) => sum + simulation.championshipProbability,
            0
          ) / seasonSimulationCount,
          4
        )
      : null

  const bestPlayoffOddsTeam =
    [...args.seasonSimulations].sort(
      (left, right) => right.playoffProbability - left.playoffProbability
    )[0] ?? null

  return {
    matchupSimulationCount,
    seasonSimulationCount,
    averageExpectedScoreA,
    averageExpectedScoreB,
    averageWinProbabilityA,
    averagePlayoffProbability,
    averageChampionshipProbability,
    bestPlayoffOddsTeamId: bestPlayoffOddsTeam?.teamId ?? null,
  }
}

async function resolveSportForOverview(
  leagueId?: string,
  sport?: string
): Promise<string | undefined> {
  if (sport) return normalizeSportForWarehouse(sport)
  if (!leagueId) return undefined

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true },
  })

  return league?.sport ? normalizeSportForWarehouse(league.sport) : undefined
}

async function findLatestCreatedAt<TWhere>(
  delegate: { findFirst(args: { where?: TWhere; orderBy: { createdAt: 'desc' }; select: { createdAt: true } }): Promise<{ createdAt: Date } | null> },
  where?: TWhere
): Promise<string | null> {
  const latest = await delegate.findFirst({
    where,
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  return latest?.createdAt.toISOString() ?? null
}

interface QueryPlayerStatsOptions {
  playerId: string
  sport: string
  season?: number
  fromWeek?: number
  toWeek?: number
  limit?: number
}

async function queryPlayerStats(options: QueryPlayerStatsOptions) {
  const sport = normalizeSportForWarehouse(options.sport)
  return getPlayerGameFactsForPlayer(options.playerId, sport, {
    season: options.season,
    fromWeek: options.fromWeek,
    toWeek: options.toWeek,
    limit: options.limit,
  })
}

async function queryPlayerFantasyPointsByPeriod(
  playerId: string,
  sport: string,
  season: number,
  weeks?: number[]
) {
  return getPlayerFantasyPointsByPeriod(
    playerId,
    normalizeSportForWarehouse(sport),
    season,
    weeks
  )
}

interface QueryLeagueResultsOptions {
  leagueId: string
  season?: number
  weekOrPeriod?: number
}

async function queryLeagueResults(options: QueryLeagueResultsOptions) {
  const { leagueId, season, weekOrPeriod } = options
  if (season == null) {
    const summary = await getLeagueHistorySummary(leagueId)
    const seasonNum = summary.season
    const [matchups, standings] = await Promise.all([
      seasonNum != null ? getMatchupHistory(leagueId, seasonNum, weekOrPeriod) : [],
      seasonNum != null ? getStandingsHistory(leagueId, seasonNum) : [],
    ])
    return { matchups, standings, season: seasonNum }
  }

  const [matchups, standings] = await Promise.all([
    getMatchupHistory(leagueId, season, weekOrPeriod),
    getStandingsHistory(leagueId, season),
  ])
  return { matchups, standings, season }
}

async function queryStandingsBySeason(leagueId: string, seasons: number[]) {
  return getStandingsBySeasonForLeague(leagueId, seasons)
}

async function queryTeamPointsByPeriod(
  leagueId: string,
  season: number,
  weekOrPeriod?: number
) {
  return getTeamPointsByPeriodForLeague(leagueId, season, weekOrPeriod)
}

interface QueryDraftLogsOptions {
  leagueId: string
  season?: number
}

async function queryDraftLogs(options: QueryDraftLogsOptions) {
  return getDraftHistoryForLeague(options.leagueId, options.season)
}

interface QueryTradeLogsOptions {
  leagueId: string
  since?: Date
  limit?: number
}

async function queryTradeLogs(options: QueryTradeLogsOptions) {
  return getTransactionHistoryForLeague(
    options.leagueId,
    options.since,
    options.limit ?? 100
  )
}

async function queryTransactionVolume(leagueIds: string[], since: Date) {
  return getTransactionVolumeByLeague(leagueIds, since)
}

interface QuerySimulationOutputsOptions {
  leagueId: string
  sport: string
  season?: number
  weekOrPeriod?: number
  teamAId?: string
  teamBId?: string
}

async function querySimulationOutputs(options: QuerySimulationOutputsOptions) {
  const { leagueId, season, weekOrPeriod, teamAId, teamBId } = options
  const matchupWhere: { leagueId: string; weekOrPeriod?: number; teamAId?: string; teamBId?: string } = {
    leagueId,
  }
  if (weekOrPeriod != null) matchupWhere.weekOrPeriod = weekOrPeriod
  if (teamAId) matchupWhere.teamAId = teamAId
  if (teamBId) matchupWhere.teamBId = teamBId

  const [matchupSims, seasonSims] = await Promise.all([
    prisma.matchupSimulationResult.findMany({
      where: matchupWhere,
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    season != null && weekOrPeriod != null
      ? prisma.seasonSimulationResult.findMany({
          where: { leagueId, season, weekOrPeriod },
          orderBy: { expectedRank: 'asc' },
        })
      : [],
  ])

  return { matchupSimulations: matchupSims, seasonSimulations: seasonSims }
}

async function queryRosterSnapshots(
  leagueId: string,
  teamId: string,
  season?: number,
  fromWeek?: number,
  toWeek?: number
) {
  return getRosterSnapshotsForTeam(leagueId, teamId, season, fromWeek, toWeek)
}

async function getLeagueSummary(leagueId: string, season?: number) {
  return getLeagueHistorySummary(leagueId, season ? { season } : undefined)
}

async function getLeagueSummaryForAI(leagueId: string, season?: number) {
  return getLeagueWarehouseSummaryForAI(leagueId, season)
}

interface QueryWarehouseOverviewOptions {
  leagueId?: string
  sport?: string
  season?: number
}

async function queryWarehouseOverview(
  options: QueryWarehouseOverviewOptions
): Promise<WarehouseOverview> {
  const sport = await resolveSportForOverview(options.leagueId, options.sport)
  const season = options.season

  const playerFactWhere = {
    ...(sport ? { sport } : {}),
    ...(season != null ? { season } : {}),
  }
  const teamFactWhere = {
    ...(sport ? { sport } : {}),
    ...(season != null ? { season } : {}),
  }
  const leagueScopedWhere = {
    ...(options.leagueId ? { leagueId: options.leagueId } : {}),
    ...(season != null ? { season } : {}),
  }
  const matchupSimulationWhere = {
    ...(options.leagueId ? { leagueId: options.leagueId } : {}),
    ...(sport ? { sport } : {}),
  }
  const seasonSimulationWhere = {
    ...(options.leagueId ? { leagueId: options.leagueId } : {}),
    ...(sport ? { sport } : {}),
    ...(season != null ? { season } : {}),
  }

  const [
    playerStats,
    teamStats,
    rosterSnapshots,
    leagueMatchups,
    seasonStandings,
    draftLogs,
    tradeLogs,
    matchupSimulations,
    seasonSimulations,
    latestPlayerStats,
    latestTeamStats,
    latestRosterSnapshots,
    latestLeagueMatchups,
    latestSeasonStandings,
    latestDraftLogs,
    latestTradeLogs,
    latestMatchupSimulations,
    latestSeasonSimulations,
  ] = await Promise.all([
    prisma.playerGameFact.count({ where: playerFactWhere }),
    prisma.teamGameFact.count({ where: teamFactWhere }),
    prisma.rosterSnapshot.count({ where: leagueScopedWhere }),
    prisma.matchupFact.count({ where: leagueScopedWhere }),
    prisma.seasonStandingFact.count({ where: leagueScopedWhere }),
    prisma.draftFact.count({ where: leagueScopedWhere }),
    prisma.transactionFact.count({ where: leagueScopedWhere }),
    prisma.matchupSimulationResult.count({ where: matchupSimulationWhere }),
    prisma.seasonSimulationResult.count({ where: seasonSimulationWhere }),
    findLatestCreatedAt(prisma.playerGameFact, playerFactWhere),
    findLatestCreatedAt(prisma.teamGameFact, teamFactWhere),
    findLatestCreatedAt(prisma.rosterSnapshot, leagueScopedWhere),
    findLatestCreatedAt(prisma.matchupFact, leagueScopedWhere),
    findLatestCreatedAt(prisma.seasonStandingFact, leagueScopedWhere),
    findLatestCreatedAt(prisma.draftFact, leagueScopedWhere),
    findLatestCreatedAt(prisma.transactionFact, leagueScopedWhere),
    findLatestCreatedAt(prisma.matchupSimulationResult, matchupSimulationWhere),
    findLatestCreatedAt(prisma.seasonSimulationResult, seasonSimulationWhere),
  ])

  return buildWarehouseOverview({
    leagueId: options.leagueId ?? null,
    sport: sport ?? null,
    season,
    counts: {
      playerStats,
      teamStats,
      rosterSnapshots,
      leagueMatchups,
      seasonStandings,
      draftLogs,
      tradeLogs,
      matchupSimulations,
      seasonSimulations,
    },
    latestByDataset: {
      playerStats: latestPlayerStats,
      teamStats: latestTeamStats,
      rosterSnapshots: latestRosterSnapshots,
      leagueMatchups: latestLeagueMatchups,
      seasonStandings: latestSeasonStandings,
      draftLogs: latestDraftLogs,
      tradeLogs: latestTradeLogs,
      matchupSimulations: latestMatchupSimulations,
      seasonSimulations: latestSeasonSimulations,
    },
  })
}

interface QueryWarehouseActivityFeedOptions {
  leagueId?: string
  sport?: string
  season?: number
  limit?: number
}

async function queryWarehouseActivityFeed(
  options: QueryWarehouseActivityFeedOptions
): Promise<WarehouseActivityEntry[]> {
  const sport = await resolveSportForOverview(options.leagueId, options.sport)
  const season = options.season
  const limitPerDataset = Math.max(5, Math.min(options.limit ?? 20, 50))

  const playerFactWhere = {
    ...(sport ? { sport } : {}),
    ...(season != null ? { season } : {}),
  }
  const teamFactWhere = {
    ...(sport ? { sport } : {}),
    ...(season != null ? { season } : {}),
  }
  const leagueScopedWhere = {
    ...(options.leagueId ? { leagueId: options.leagueId } : {}),
    ...(season != null ? { season } : {}),
  }
  const matchupSimulationWhere = {
    ...(options.leagueId ? { leagueId: options.leagueId } : {}),
    ...(sport ? { sport } : {}),
  }
  const seasonSimulationWhere = {
    ...(options.leagueId ? { leagueId: options.leagueId } : {}),
    ...(sport ? { sport } : {}),
    ...(season != null ? { season } : {}),
  }

  const [
    playerFacts,
    teamFacts,
    rosterSnapshots,
    matchups,
    standings,
    drafts,
    transactions,
    matchupSimulations,
    seasonSimulations,
  ] = await Promise.all([
    prisma.playerGameFact.findMany({
      where: playerFactWhere,
      orderBy: { createdAt: 'desc' },
      take: limitPerDataset,
      select: { factId: true, playerId: true, sport: true, season: true, weekOrRound: true, createdAt: true },
    }),
    prisma.teamGameFact.findMany({
      where: teamFactWhere,
      orderBy: { createdAt: 'desc' },
      take: limitPerDataset,
      select: { factId: true, teamId: true, sport: true, season: true, weekOrRound: true, createdAt: true },
    }),
    prisma.rosterSnapshot.findMany({
      where: leagueScopedWhere,
      orderBy: { createdAt: 'desc' },
      take: limitPerDataset,
      select: {
        snapshotId: true,
        leagueId: true,
        teamId: true,
        sport: true,
        season: true,
        weekOrPeriod: true,
        createdAt: true,
      },
    }),
    prisma.matchupFact.findMany({
      where: leagueScopedWhere,
      orderBy: { createdAt: 'desc' },
      take: limitPerDataset,
      select: {
        matchupId: true,
        leagueId: true,
        sport: true,
        season: true,
        weekOrPeriod: true,
        teamA: true,
        teamB: true,
        createdAt: true,
      },
    }),
    prisma.seasonStandingFact.findMany({
      where: leagueScopedWhere,
      orderBy: { createdAt: 'desc' },
      take: limitPerDataset,
      select: {
        standingId: true,
        leagueId: true,
        sport: true,
        season: true,
        teamId: true,
        rank: true,
        createdAt: true,
      },
    }),
    prisma.draftFact.findMany({
      where: leagueScopedWhere,
      orderBy: { createdAt: 'desc' },
      take: limitPerDataset,
      select: {
        draftId: true,
        leagueId: true,
        sport: true,
        season: true,
        round: true,
        pickNumber: true,
        playerId: true,
        managerId: true,
        createdAt: true,
      },
    }),
    prisma.transactionFact.findMany({
      where: leagueScopedWhere,
      orderBy: { createdAt: 'desc' },
      take: limitPerDataset,
      select: {
        transactionId: true,
        leagueId: true,
        sport: true,
        season: true,
        weekOrPeriod: true,
        type: true,
        playerId: true,
        rosterId: true,
        createdAt: true,
      },
    }),
    prisma.matchupSimulationResult.findMany({
      where: matchupSimulationWhere,
      orderBy: { createdAt: 'desc' },
      take: limitPerDataset,
      select: {
        simulationId: true,
        leagueId: true,
        sport: true,
        weekOrPeriod: true,
        teamAId: true,
        teamBId: true,
        createdAt: true,
      },
    }),
    prisma.seasonSimulationResult.findMany({
      where: seasonSimulationWhere,
      orderBy: { createdAt: 'desc' },
      take: limitPerDataset,
      select: {
        resultId: true,
        leagueId: true,
        sport: true,
        season: true,
        weekOrPeriod: true,
        teamId: true,
        createdAt: true,
      },
    }),
  ])

  return buildWarehouseActivityFeed(
    [
      ...playerFacts.map((fact) => ({
        dataset: 'player_stats' as const,
        recordId: fact.factId,
        occurredAt: fact.createdAt.toISOString(),
        title: `Player stat fact for ${fact.playerId}`,
        detail: `${fact.sport} week ${fact.weekOrRound ?? 0}`,
        sport: fact.sport,
        season: fact.season,
        weekOrPeriod: fact.weekOrRound,
        playerId: fact.playerId,
      })),
      ...teamFacts.map((fact) => ({
        dataset: 'team_stats' as const,
        recordId: fact.factId,
        occurredAt: fact.createdAt.toISOString(),
        title: `Team stat fact for ${fact.teamId}`,
        detail: `${fact.sport} week ${fact.weekOrRound ?? 0}`,
        sport: fact.sport,
        season: fact.season,
        weekOrPeriod: fact.weekOrRound,
        teamId: fact.teamId,
      })),
      ...rosterSnapshots.map((snapshot) => ({
        dataset: 'roster_snapshots' as const,
        recordId: snapshot.snapshotId,
        occurredAt: snapshot.createdAt.toISOString(),
        title: `Roster snapshot for ${snapshot.teamId}`,
        detail: `Week ${snapshot.weekOrPeriod} snapshot`,
        leagueId: snapshot.leagueId,
        sport: snapshot.sport,
        season: snapshot.season,
        weekOrPeriod: snapshot.weekOrPeriod,
        teamId: snapshot.teamId,
      })),
      ...matchups.map((matchup) => ({
        dataset: 'league_matchups' as const,
        recordId: matchup.matchupId,
        occurredAt: matchup.createdAt.toISOString(),
        title: `${matchup.teamA} vs ${matchup.teamB}`,
        detail: `League matchup fact for week ${matchup.weekOrPeriod}`,
        leagueId: matchup.leagueId,
        sport: matchup.sport,
        season: matchup.season,
        weekOrPeriod: matchup.weekOrPeriod,
      })),
      ...standings.map((standing) => ({
        dataset: 'season_standings' as const,
        recordId: standing.standingId,
        occurredAt: standing.createdAt.toISOString(),
        title: `Standing update for ${standing.teamId}`,
        detail: `Season ${standing.season} rank ${standing.rank ?? '--'}`,
        leagueId: standing.leagueId,
        sport: standing.sport,
        season: standing.season,
        teamId: standing.teamId,
      })),
      ...drafts.map((draft) => ({
        dataset: 'draft_logs' as const,
        recordId: draft.draftId,
        occurredAt: draft.createdAt.toISOString(),
        title: `Draft pick ${draft.round}.${draft.pickNumber}`,
        detail: `Player ${draft.playerId}${draft.managerId ? ` to ${draft.managerId}` : ''}`,
        leagueId: draft.leagueId,
        sport: draft.sport,
        season: draft.season,
        playerId: draft.playerId,
      })),
      ...transactions.map((transaction) => ({
        dataset: 'trade_logs' as const,
        recordId: transaction.transactionId,
        occurredAt: transaction.createdAt.toISOString(),
        title: `${transaction.type} transaction`,
        detail: transaction.playerId
          ? `Player ${transaction.playerId}${transaction.rosterId ? ` on roster ${transaction.rosterId}` : ''}`
          : 'League transaction fact',
        leagueId: transaction.leagueId,
        sport: transaction.sport,
        season: transaction.season,
        weekOrPeriod: transaction.weekOrPeriod,
        playerId: transaction.playerId,
      })),
      ...matchupSimulations.map((simulation) => ({
        dataset: 'matchup_simulations' as const,
        recordId: simulation.simulationId,
        occurredAt: simulation.createdAt.toISOString(),
        title: `Matchup sim ${simulation.teamAId ?? 'A'} vs ${simulation.teamBId ?? 'B'}`,
        detail: `Simulation output for week ${simulation.weekOrPeriod}`,
        leagueId: simulation.leagueId,
        sport: simulation.sport,
        weekOrPeriod: simulation.weekOrPeriod,
      })),
      ...seasonSimulations.map((simulation) => ({
        dataset: 'season_simulations' as const,
        recordId: simulation.resultId,
        occurredAt: simulation.createdAt.toISOString(),
        title: `Season sim for ${simulation.teamId}`,
        detail: `Season ${simulation.season} period ${simulation.weekOrPeriod}`,
        leagueId: simulation.leagueId,
        sport: simulation.sport,
        season: simulation.season,
        weekOrPeriod: simulation.weekOrPeriod,
        teamId: simulation.teamId,
      })),
    ],
    options.limit ?? 20
  )
}

interface QuerySimulationAnalyticsOptions {
  leagueId: string
  sport: string
  season?: number
  weekOrPeriod?: number
  teamAId?: string
  teamBId?: string
}

async function querySimulationAnalytics(
  options: QuerySimulationAnalyticsOptions
): Promise<WarehouseSimulationAnalytics> {
  const result = await querySimulationOutputs(options)
  return buildWarehouseSimulationAnalytics(result)
}

interface QueryCentralAnalyticsSnapshotOptions {
  leagueId?: string
  sport?: string
  season?: number
  recentActivityLimit?: number
  weekOrPeriod?: number
}

async function queryCentralAnalyticsSnapshot(options: QueryCentralAnalyticsSnapshotOptions) {
  const overview = await queryWarehouseOverview({
    leagueId: options.leagueId,
    sport: options.sport,
    season: options.season,
  })

  const resolvedSport = overview.sport ?? null

  const [recentActivity, simulationAnalytics, leagueSummaryForAI] = await Promise.all([
    queryWarehouseActivityFeed({
      leagueId: options.leagueId,
      sport: resolvedSport ?? options.sport,
      season: options.season,
      limit: options.recentActivityLimit ?? 20,
    }),
    options.leagueId && resolvedSport
      ? querySimulationAnalytics({
          leagueId: options.leagueId,
          sport: resolvedSport,
          season: options.season,
          weekOrPeriod: options.weekOrPeriod,
        })
      : Promise.resolve(
          buildWarehouseSimulationAnalytics({
            matchupSimulations: [],
            seasonSimulations: [],
          })
        ),
    options.leagueId ? getLeagueSummaryForAI(options.leagueId, options.season) : Promise.resolve(null),
  ])

  return {
    overview,
    recentActivity,
    simulationAnalytics,
    leagueSummaryForAI,
  }
}

export const AnalyticsQueryLayer = {
  queryPlayerStats,
  queryPlayerFantasyPointsByPeriod,
  queryLeagueResults,
  queryStandingsBySeason,
  queryTeamPointsByPeriod,
  queryDraftLogs,
  queryTradeLogs,
  queryTransactionVolume,
  querySimulationOutputs,
  querySimulationAnalytics,
  queryRosterSnapshots,
  getLeagueSummary,
  getLeagueSummaryForAI,
  queryWarehouseOverview,
  queryWarehouseActivityFeed,
  queryCentralAnalyticsSnapshot,
}
