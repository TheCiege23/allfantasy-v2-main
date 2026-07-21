/**
 * Warehouse backfill orchestrator — runs ingestion pipelines for leagues and/or game stats.
 * Call from POST /api/admin/warehouse/backfill or a scheduled job.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizeSportForWarehouse } from './types'
import {
  runGameStatsIngestionPipeline,
  runMatchupScoringPipeline,
  runRosterSnapshotPipeline,
  runStandingsIngestionPipeline,
  runDraftIngestionPipeline,
  runTransactionIngestionPipeline,
} from './pipelines'

export type BackfillPipeline = 'gameStats' | 'matchups' | 'standings' | 'rosterSnapshots' | 'drafts' | 'transactions'

type BackfillErrorPipeline = BackfillPipeline | 'orchestrator'

interface BackfillObservability {
  startedAt: string
  finishedAt: string
  totalDurationMs: number
  pipelineDurationMs: Partial<Record<BackfillPipeline, number>>
  errorsByLeague: Array<{
    leagueId: string
    byPipeline: Partial<Record<BackfillErrorPipeline, string[]>>
  }>
}

export interface BackfillOptions {
  /** Specific league IDs; if empty, all leagues matching sport/season are used */
  leagueIds?: string[]
  /** Filter leagues by sport (e.g. NFL) */
  sport?: string
  /** Season year (e.g. 2024). Used for standings, matchups, roster; and for game stats if run */
  season?: number
  /** Week numbers to run for matchups/roster (e.g. [1,2,3,...,14]). If omitted, 1–18 are used for league backfill */
  weeks?: number[]
  /** Which pipelines to run. Default: all except gameStats (gameStats requires sport+season+weeks) */
  pipelines?: BackfillPipeline[]
  /** If true, only report what would be run; do not write */
  dryRun?: boolean
}

export interface BackfillResult {
  ok: boolean
  dryRun: boolean
  leaguesProcessed: number
  gameStats?: { sport: string; season: number; week: number; playerFacts: number; teamFacts: number; status?: string }[]
  /** Weeks whose source stat tables were empty (MISSING_SOURCE_DATA) — actionable, not a success. */
  gameStatsWarnings?: string[]
  standings?: { leagueId: string; season: number; standingCount: number }[]
  matchups?: { leagueId: string; season: number; week: number; matchupCount: number }[]
  rosterSnapshots?: { leagueId: string; weekOrPeriod: number; snapshotCount: number }[]
  drafts?: { leagueId: string; draftFactCount: number }[]
  transactions?: { leagueId: string; transactionCount: number }[]
  errors: string[]
  observability: BackfillObservability
}

export async function runWarehouseBackfill(options: BackfillOptions): Promise<BackfillResult> {
  const startedAtMs = Date.now()
  const {
    leagueIds: inputLeagueIds = [],
    sport: inputSport,
    season: inputSeason,
    weeks: inputWeeks,
    pipelines = ['standings', 'matchups', 'rosterSnapshots', 'drafts', 'transactions'],
    dryRun = false,
  } = options

  const errors: string[] = []
  const pipelineDurationMs: Partial<Record<BackfillPipeline, number>> = {}
  const errorMap = new Map<string, Map<BackfillErrorPipeline, string[]>>()

  const trackDuration = (pipeline: BackfillPipeline, durationMs: number) => {
    pipelineDurationMs[pipeline] = (pipelineDurationMs[pipeline] ?? 0) + durationMs
  }

  const addGroupedError = (leagueId: string, pipeline: BackfillErrorPipeline, message: string) => {
    if (!errorMap.has(leagueId)) errorMap.set(leagueId, new Map())
    const byPipeline = errorMap.get(leagueId)!
    if (!byPipeline.has(pipeline)) byPipeline.set(pipeline, [])
    byPipeline.get(pipeline)!.push(message)
  }

  const gameStatsResults: NonNullable<BackfillResult['gameStats']> = []
  const gameStatsWarnings: string[] = []
  const standingsResults: BackfillResult['standings'] = []
  const matchupsResults: BackfillResult['matchups'] = []
  const rosterSnapshotsResults: BackfillResult['rosterSnapshots'] = []
  const draftResults: BackfillResult['drafts'] = []
  const transactionsResults: BackfillResult['transactions'] = []

  const runGameStats = pipelines.includes('gameStats')
  const runMatchups = pipelines.includes('matchups')
  const runStandings = pipelines.includes('standings')
  const runRosterSnapshots = pipelines.includes('rosterSnapshots')
  const runDrafts = pipelines.includes('drafts')
  const runTransactions = pipelines.includes('transactions')

  let leagueIds = inputLeagueIds.slice()

  if (leagueIds.length === 0) {
    const where: Prisma.LeagueWhereInput = {}
    if (inputSport) where.sport = normalizeSportForWarehouse(inputSport) as Prisma.LeagueWhereInput['sport']
    if (inputSeason != null) where.season = inputSeason
    const leagues = await prisma.league.findMany({
      where,
      select: { id: true },
    })
    leagueIds = leagues.map((l) => l.id)
  }

  const season = inputSeason ?? new Date().getFullYear()
  const weeks = inputWeeks?.length ? inputWeeks : Array.from({ length: 18 }, (_, i) => i + 1)

  for (const leagueId of leagueIds) {
    try {
      const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, season: true } })
      if (!league) {
        const msg = `League not found: ${leagueId}`
        errors.push(msg)
        addGroupedError(leagueId, 'orchestrator', msg)
        continue
      }
      const leagueSeason = inputSeason ?? league.season ?? season

      if (runStandings && !dryRun) {
        const t0 = Date.now()
        try {
          const r = await runStandingsIngestionPipeline(leagueId, leagueSeason)
          standingsResults.push(r)
        } catch (e) {
          const msg = `${leagueId} standings: ${e instanceof Error ? e.message : String(e)}`
          errors.push(msg)
          addGroupedError(leagueId, 'standings', msg)
        } finally {
          trackDuration('standings', Date.now() - t0)
        }
      } else if (runStandings && dryRun) {
        standingsResults.push({ leagueId, season: leagueSeason, standingCount: 0 })
      }

      if (runTransactions && !dryRun) {
        const t0 = Date.now()
        try {
          const r = await runTransactionIngestionPipeline(leagueId)
          transactionsResults.push(r)
        } catch (e) {
          const msg = `${leagueId} transactions: ${e instanceof Error ? e.message : String(e)}`
          errors.push(msg)
          addGroupedError(leagueId, 'transactions', msg)
        } finally {
          trackDuration('transactions', Date.now() - t0)
        }
      } else if (runTransactions && dryRun) {
        transactionsResults.push({ leagueId, transactionCount: 0 })
      }

      if (runDrafts && !dryRun) {
        const t0 = Date.now()
        try {
          const r = await runDraftIngestionPipeline(leagueId, leagueSeason)
          draftResults.push(r)
        } catch (e) {
          const msg = `${leagueId} drafts: ${e instanceof Error ? e.message : String(e)}`
          errors.push(msg)
          addGroupedError(leagueId, 'drafts', msg)
        } finally {
          trackDuration('drafts', Date.now() - t0)
        }
      } else if (runDrafts && dryRun) {
        draftResults.push({ leagueId, draftFactCount: 0 })
      }

      if (runMatchups || runRosterSnapshots) {
        for (const week of weeks) {
          if (runMatchups && !dryRun) {
            const t0 = Date.now()
            try {
              const r = await runMatchupScoringPipeline(leagueId, leagueSeason, week)
              matchupsResults.push(r)
            } catch (e) {
              const msg = `${leagueId} matchups w${week}: ${e instanceof Error ? e.message : String(e)}`
              errors.push(msg)
              addGroupedError(leagueId, 'matchups', msg)
            } finally {
              trackDuration('matchups', Date.now() - t0)
            }
          } else if (runMatchups && dryRun) {
            matchupsResults.push({ leagueId, season: leagueSeason, week, matchupCount: 0 })
          }
          if (runRosterSnapshots && !dryRun) {
            const t0 = Date.now()
            try {
              const r = await runRosterSnapshotPipeline(leagueId, week, leagueSeason)
              rosterSnapshotsResults.push(r)
            } catch (e) {
              const msg = `${leagueId} rosterSnapshots w${week}: ${e instanceof Error ? e.message : String(e)}`
              errors.push(msg)
              addGroupedError(leagueId, 'rosterSnapshots', msg)
            } finally {
              trackDuration('rosterSnapshots', Date.now() - t0)
            }
          } else if (runRosterSnapshots && dryRun) {
            rosterSnapshotsResults.push({ leagueId, weekOrPeriod: week, snapshotCount: 0 })
          }
        }
      }
    } catch (e) {
      const msg = `${leagueId}: ${e instanceof Error ? e.message : String(e)}`
      errors.push(msg)
      addGroupedError(leagueId, 'orchestrator', msg)
    }
  }

  if (runGameStats && inputSport && inputSeason != null) {
    const sportNorm = normalizeSportForWarehouse(inputSport)
    for (const week of weeks) {
      const t0 = Date.now()
      try {
        if (!dryRun) {
          const r = await runGameStatsIngestionPipeline(sportNorm, inputSeason, week)
          gameStatsResults.push({ sport: r.sport, season: r.season, week: r.weekOrRound, playerFacts: r.playerFacts, teamFacts: r.teamFacts, status: r.status })
          gameStatsWarnings.push(...r.warnings)
        } else {
          gameStatsResults.push({ sport: sportNorm, season: inputSeason, week, playerFacts: 0, teamFacts: 0, status: 'DRY_RUN' })
        }
      } catch (e) {
        const pseudoLeagueId = `gameStats:${sportNorm}:${inputSeason}`
        const msg = `gameStats ${sportNorm} ${inputSeason} w${week}: ${e instanceof Error ? e.message : String(e)}`
        errors.push(msg)
        addGroupedError(pseudoLeagueId, 'gameStats', msg)
      } finally {
        trackDuration('gameStats', Date.now() - t0)
      }
    }
  }

  const finishedAtMs = Date.now()
  const errorsByLeague = Array.from(errorMap.entries()).map(([leagueId, byPipelineMap]) => ({
    leagueId,
    byPipeline: Object.fromEntries(byPipelineMap.entries()) as Partial<Record<BackfillErrorPipeline, string[]>>,
  }))

  return {
    ok: errors.length === 0,
    dryRun,
    leaguesProcessed: leagueIds.length,
    gameStats: runGameStats ? gameStatsResults : undefined,
    gameStatsWarnings: runGameStats && gameStatsWarnings.length > 0 ? gameStatsWarnings : undefined,
    standings: runStandings ? standingsResults : undefined,
    matchups: runMatchups ? matchupsResults : undefined,
    rosterSnapshots: runRosterSnapshots ? rosterSnapshotsResults : undefined,
    drafts: runDrafts ? draftResults : undefined,
    transactions: runTransactions ? transactionsResults : undefined,
    errors,
    observability: {
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      totalDurationMs: finishedAtMs - startedAtMs,
      pipelineDurationMs,
      errorsByLeague,
    },
  }
}
