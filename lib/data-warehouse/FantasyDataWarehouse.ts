/**
 * FantasyDataWarehouse (PROMPT 138) central analytics storage facade.
 * Stores player stats, league results, draft logs, trade logs, and simulation outputs.
 */

import { prisma } from '@/lib/prisma'
import { toPrismaNullableJsonInput } from '@/lib/prisma-json'
import {
  WarehouseIngestionService,
  type WarehouseIngestionWriteClient,
} from './WarehouseIngestionService'
import type {
  DraftFactInput,
  MatchupFactInput,
  PlayerGameFactInput,
  RosterSnapshotInput,
  SeasonStandingFactInput,
  TeamGameFactInput,
  TransactionFactInput,
  WarehouseDatasetCounts,
} from './types'
import { normalizeSportForWarehouse } from './types'

type WarehouseSimulationWriteClient = Pick<
  typeof prisma,
  'matchupSimulationResult' | 'seasonSimulationResult'
>

type WarehouseBundleWriteClient = WarehouseIngestionWriteClient & WarehouseSimulationWriteClient

export interface StorePlayerStatsInput extends Omit<PlayerGameFactInput, 'sport'> {
  sport: string
}

export interface StoreTeamGameStatsInput extends Omit<TeamGameFactInput, 'sport'> {
  sport: string
}

export interface StoreRosterSnapshotInput extends Omit<RosterSnapshotInput, 'sport'> {
  sport: string
}

export interface StoreLeagueResultMatchupInput extends Omit<MatchupFactInput, 'sport'> {
  sport: string
}

export interface StoreLeagueResultStandingInput extends Omit<SeasonStandingFactInput, 'sport'> {
  sport: string
}

export interface StoreDraftLogInput extends Omit<DraftFactInput, 'sport'> {
  sport: string
}

export interface StoreTradeLogInput extends Omit<TransactionFactInput, 'sport'> {
  sport: string
}

export interface StoreMatchupSimulationInput {
  sport: string
  leagueId: string | null
  weekOrPeriod: number
  teamAId: string | null
  teamBId: string | null
  expectedScoreA: number
  expectedScoreB: number
  winProbabilityA: number
  winProbabilityB: number
  scoreDistributionA?: Record<string, unknown> | null
  scoreDistributionB?: Record<string, unknown> | null
  iterations?: number
}

export interface StoreSeasonSimulationInput {
  sport: string
  leagueId: string
  teamId: string
  season: number
  weekOrPeriod: number
  playoffProbability?: number
  championshipProbability?: number
  expectedWins?: number
  expectedRank?: number
  simulationsRun?: number
}

export interface StoreWarehouseBundleInput {
  playerStats?: StorePlayerStatsInput[]
  teamGameStats?: StoreTeamGameStatsInput[]
  rosterSnapshots?: StoreRosterSnapshotInput[]
  leagueResults?: {
    matchups?: StoreLeagueResultMatchupInput[]
    standings?: StoreLeagueResultStandingInput[]
  }
  draftLogs?: StoreDraftLogInput[]
  tradeLogs?: StoreTradeLogInput[]
  simulationOutputs?: {
    matchups?: StoreMatchupSimulationInput[]
    seasonResults?: StoreSeasonSimulationInput[]
  }
}

export interface WarehouseStoreIds {
  playerStats: string[]
  teamGameStats: string[]
  rosterSnapshots: string[]
  matchupResults: string[]
  standings: string[]
  draftLogs: string[]
  tradeLogs: string[]
  matchupSimulations: string[]
  seasonSimulations: string[]
}

export interface WarehouseStoreBundleResult {
  counts: WarehouseDatasetCounts
  totalRecords: number
  ids: WarehouseStoreIds
}

function normalizePlayerStatsInput(input: StorePlayerStatsInput): PlayerGameFactInput {
  return {
    ...input,
    sport: normalizeSportForWarehouse(input.sport),
  }
}

function normalizeTeamGameStatsInput(input: StoreTeamGameStatsInput): TeamGameFactInput {
  return {
    ...input,
    sport: normalizeSportForWarehouse(input.sport),
  }
}

function normalizeRosterSnapshotInput(input: StoreRosterSnapshotInput): RosterSnapshotInput {
  return {
    ...input,
    sport: normalizeSportForWarehouse(input.sport),
  }
}

function normalizeMatchupInput(input: StoreLeagueResultMatchupInput): MatchupFactInput {
  return {
    ...input,
    sport: normalizeSportForWarehouse(input.sport),
  }
}

function normalizeStandingInput(input: StoreLeagueResultStandingInput): SeasonStandingFactInput {
  return {
    ...input,
    sport: normalizeSportForWarehouse(input.sport),
  }
}

function normalizeDraftInput(input: StoreDraftLogInput): DraftFactInput {
  return {
    ...input,
    sport: normalizeSportForWarehouse(input.sport),
  }
}

function normalizeTransactionInput(input: StoreTradeLogInput): TransactionFactInput {
  return {
    ...input,
    sport: normalizeSportForWarehouse(input.sport),
  }
}

function buildEmptyStoreIds(): WarehouseStoreIds {
  return {
    playerStats: [],
    teamGameStats: [],
    rosterSnapshots: [],
    matchupResults: [],
    standings: [],
    draftLogs: [],
    tradeLogs: [],
    matchupSimulations: [],
    seasonSimulations: [],
  }
}

function roundTo(value: number, digits = 2): number {
  return Number(value.toFixed(digits))
}

export function buildWarehouseStoreBundleResult(ids: WarehouseStoreIds): WarehouseStoreBundleResult {
  const counts: WarehouseDatasetCounts = {
    playerStats: ids.playerStats.length,
    teamStats: ids.teamGameStats.length,
    rosterSnapshots: ids.rosterSnapshots.length,
    leagueMatchups: ids.matchupResults.length,
    seasonStandings: ids.standings.length,
    draftLogs: ids.draftLogs.length,
    tradeLogs: ids.tradeLogs.length,
    matchupSimulations: ids.matchupSimulations.length,
    seasonSimulations: ids.seasonSimulations.length,
  }
  const totalRecords = Object.values(counts).reduce((sum, count) => sum + count, 0)

  return {
    counts,
    totalRecords,
    ids,
  }
}

async function persistMatchupSimulationOutput(
  db: WarehouseSimulationWriteClient,
  input: StoreMatchupSimulationInput
): Promise<string> {
  const sport = normalizeSportForWarehouse(input.sport)
  const row = await db.matchupSimulationResult.create({
    data: {
      sport,
      leagueId: input.leagueId ?? undefined,
      weekOrPeriod: input.weekOrPeriod,
      teamAId: input.teamAId ?? undefined,
      teamBId: input.teamBId ?? undefined,
      expectedScoreA: roundTo(input.expectedScoreA, 2),
      expectedScoreB: roundTo(input.expectedScoreB, 2),
      winProbabilityA: roundTo(input.winProbabilityA, 4),
      winProbabilityB: roundTo(input.winProbabilityB, 4),
      scoreDistributionA: toPrismaNullableJsonInput(input.scoreDistributionA),
      scoreDistributionB: toPrismaNullableJsonInput(input.scoreDistributionB),
      iterations: input.iterations ?? 2000,
    },
  })
  return row.simulationId
}

async function persistSeasonSimulationOutput(
  db: WarehouseSimulationWriteClient,
  input: StoreSeasonSimulationInput
): Promise<string> {
  const sport = normalizeSportForWarehouse(input.sport)
  const row = await db.seasonSimulationResult.create({
    data: {
      sport,
      leagueId: input.leagueId,
      teamId: input.teamId,
      season: input.season,
      weekOrPeriod: input.weekOrPeriod,
      playoffProbability: roundTo(input.playoffProbability ?? 0, 4),
      championshipProbability: roundTo(input.championshipProbability ?? 0, 4),
      expectedWins: roundTo(input.expectedWins ?? 0, 2),
      expectedRank: roundTo(input.expectedRank ?? 0, 2),
      simulationsRun: input.simulationsRun ?? 0,
    },
  })
  return row.resultId
}

const ingestion = new WarehouseIngestionService()

export async function storePlayerStats(input: StorePlayerStatsInput): Promise<string> {
  return ingestion.ingestPlayerGameFact(normalizePlayerStatsInput(input))
}

export async function storePlayerStatsBatch(inputs: StorePlayerStatsInput[]): Promise<string[]> {
  return Promise.all(inputs.map((input) => storePlayerStats(input)))
}

export async function storeTeamGameStats(input: StoreTeamGameStatsInput): Promise<string> {
  return ingestion.ingestTeamGameFact(normalizeTeamGameStatsInput(input))
}

export async function storeTeamGameStatsBatch(inputs: StoreTeamGameStatsInput[]): Promise<string[]> {
  return Promise.all(inputs.map((input) => storeTeamGameStats(input)))
}

export async function storeRosterSnapshot(input: StoreRosterSnapshotInput): Promise<string> {
  return ingestion.ingestRosterSnapshot(normalizeRosterSnapshotInput(input))
}

export async function storeRosterSnapshotsBatch(inputs: StoreRosterSnapshotInput[]): Promise<string[]> {
  return Promise.all(inputs.map((input) => storeRosterSnapshot(input)))
}

export async function storeLeagueResultMatchup(input: StoreLeagueResultMatchupInput): Promise<string> {
  return ingestion.ingestMatchupFact(normalizeMatchupInput(input))
}

export async function storeLeagueResultStanding(input: StoreLeagueResultStandingInput): Promise<string> {
  return ingestion.ingestSeasonStandingFact(normalizeStandingInput(input))
}

export async function storeLeagueResults(opts: {
  matchups?: StoreLeagueResultMatchupInput[]
  standings?: StoreLeagueResultStandingInput[]
}): Promise<{ matchupIds: string[]; standingIds: string[] }> {
  const [matchupIds, standingIds] = await Promise.all([
    opts.matchups?.length
      ? Promise.all(opts.matchups.map((matchup) => storeLeagueResultMatchup(matchup)))
      : Promise.resolve([]),
    opts.standings?.length
      ? Promise.all(opts.standings.map((standing) => storeLeagueResultStanding(standing)))
      : Promise.resolve([]),
  ])

  return { matchupIds, standingIds }
}

export async function storeDraftLog(input: StoreDraftLogInput): Promise<string> {
  return ingestion.ingestDraftFact(normalizeDraftInput(input))
}

export async function storeDraftLogsBatch(inputs: StoreDraftLogInput[]): Promise<string[]> {
  return Promise.all(inputs.map((input) => storeDraftLog(input)))
}

export async function storeTradeLog(input: StoreTradeLogInput): Promise<string> {
  return ingestion.ingestTransactionFact(normalizeTransactionInput(input))
}

export async function storeTradeLogsBatch(inputs: StoreTradeLogInput[]): Promise<string[]> {
  return Promise.all(inputs.map((input) => storeTradeLog(input)))
}

export async function storeMatchupSimulationOutput(input: StoreMatchupSimulationInput): Promise<string> {
  return persistMatchupSimulationOutput(prisma, input)
}

export async function storeSeasonSimulationOutput(input: StoreSeasonSimulationInput): Promise<string> {
  return persistSeasonSimulationOutput(prisma, input)
}

export async function storeSimulationOutputs(opts: {
  matchup?: StoreMatchupSimulationInput
  seasonResults?: StoreSeasonSimulationInput[]
}): Promise<{ matchupId?: string; seasonResultIds: string[] }> {
  const matchupId = opts.matchup ? await storeMatchupSimulationOutput(opts.matchup) : undefined
  const seasonResultIds = opts.seasonResults?.length
    ? await Promise.all(opts.seasonResults.map((result) => storeSeasonSimulationOutput(result)))
    : []

  return { matchupId, seasonResultIds }
}

export async function storeWarehouseBundle(
  input: StoreWarehouseBundleInput
): Promise<WarehouseStoreBundleResult> {
  return prisma.$transaction(async (tx) => {
    const ids = buildEmptyStoreIds()
    const transactionalIngestion = new WarehouseIngestionService(tx as WarehouseIngestionWriteClient)
    const transactionalSimulationClient = tx as WarehouseBundleWriteClient

    if (input.playerStats?.length) {
      for (const playerStat of input.playerStats) {
        ids.playerStats.push(
          await transactionalIngestion.ingestPlayerGameFact(normalizePlayerStatsInput(playerStat))
        )
      }
    }

    if (input.teamGameStats?.length) {
      for (const teamGameStat of input.teamGameStats) {
        ids.teamGameStats.push(
          await transactionalIngestion.ingestTeamGameFact(normalizeTeamGameStatsInput(teamGameStat))
        )
      }
    }

    if (input.rosterSnapshots?.length) {
      for (const rosterSnapshot of input.rosterSnapshots) {
        ids.rosterSnapshots.push(
          await transactionalIngestion.ingestRosterSnapshot(normalizeRosterSnapshotInput(rosterSnapshot))
        )
      }
    }

    if (input.leagueResults?.matchups?.length) {
      for (const matchup of input.leagueResults.matchups) {
        ids.matchupResults.push(
          await transactionalIngestion.ingestMatchupFact(normalizeMatchupInput(matchup))
        )
      }
    }

    if (input.leagueResults?.standings?.length) {
      for (const standing of input.leagueResults.standings) {
        ids.standings.push(
          await transactionalIngestion.ingestSeasonStandingFact(normalizeStandingInput(standing))
        )
      }
    }

    if (input.draftLogs?.length) {
      for (const draftLog of input.draftLogs) {
        ids.draftLogs.push(await transactionalIngestion.ingestDraftFact(normalizeDraftInput(draftLog)))
      }
    }

    if (input.tradeLogs?.length) {
      for (const tradeLog of input.tradeLogs) {
        ids.tradeLogs.push(
          await transactionalIngestion.ingestTransactionFact(normalizeTransactionInput(tradeLog))
        )
      }
    }

    if (input.simulationOutputs?.matchups?.length) {
      for (const simulation of input.simulationOutputs.matchups) {
        ids.matchupSimulations.push(
          await persistMatchupSimulationOutput(transactionalSimulationClient, simulation)
        )
      }
    }

    if (input.simulationOutputs?.seasonResults?.length) {
      for (const simulation of input.simulationOutputs.seasonResults) {
        ids.seasonSimulations.push(
          await persistSeasonSimulationOutput(transactionalSimulationClient, simulation)
        )
      }
    }

    return buildWarehouseStoreBundleResult(ids)
  })
}

export const FantasyDataWarehouse = {
  storePlayerStats,
  storePlayerStatsBatch,
  storeTeamGameStats,
  storeTeamGameStatsBatch,
  storeRosterSnapshot,
  storeRosterSnapshotsBatch,
  storeLeagueResultMatchup,
  storeLeagueResultStanding,
  storeLeagueResults,
  storeDraftLog,
  storeDraftLogsBatch,
  storeTradeLog,
  storeTradeLogsBatch,
  storeMatchupSimulationOutput,
  storeSeasonSimulationOutput,
  storeSimulationOutputs,
  storeWarehouseBundle,
}
