/**
 * AnalyticsQueryLayer (PROMPT 138) unified query API over the fantasy data warehouse.
 * Query player stats, league results, draft logs, trade logs, simulation outputs, and snapshots.
 */

import { normalizeSportForWarehouse } from './types'
import type {
  WarehouseActivityEntry,
  WarehouseDatasetCounts,
  WarehouseDatasetLatest,
  WarehouseOverview,
  WarehouseSimulationAnalytics,
} from './types'
import { type LeagueHistorySummary } from './LeagueHistoryAggregator'

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

