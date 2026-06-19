/**
 * Sync/audit Rolling Insights NFL source data, then generate canonical AF projections.
 *
 * Default is read-only:
 *   node --require ./scripts/_audit-preload.cjs --import tsx scripts/sync-rolling-insights-nfl-foundation.ts -- --season=2026 --week=1 --json
 *
 * DB writes require --write:
 *   node --env-file=.env --require ./scripts/_audit-preload.cjs --import tsx scripts/sync-rolling-insights-nfl-foundation.ts -- --season=2026 --week=1 --write --json
 */

import { prisma } from '../lib/prisma'
import { prisma as aliasPrisma } from '@/lib/prisma'
import {
  fetchNFLDepthCharts,
  fetchNFLRoster,
  fetchNFLTeams,
  fetchNFLTeamsFull,
  syncNFLDepthChartsToDb,
  syncNFLPlayersToDb,
  syncNFLTeamsToDb,
  syncNFLTeamStatsToDb,
} from '../lib/rolling-insights'
import { generateAndPersistCanonicalNflProjections } from '../lib/nfl-data-foundation/nflDataFoundationService'
import { getCanonicalNflDataCoverage } from '../lib/nfl-data-foundation/nflDataCoverage'
import {
  auditNflRollingInsightsIdentity,
  backfillNflRollingInsightsIdentities,
  rollingInsightsSeasonRange,
  syncNflFoundationInjuries,
  syncNflFoundationSchedule,
  syncNflFoundationSeasonStats,
} from '../lib/nfl-data-foundation/nflFoundationSync'
import {
  assertProviderWriteAllowed,
  inspectProviderWriteSafety,
} from '../lib/provider-data-foundation/writeSafety'

type Args = {
  json: boolean
  season: number
  week: number
  limit: number
  skipProviderSync: boolean
  write: boolean
  dryRun: boolean
}

type ProviderCounts = {
  teams: number
  players: number
  schedule: number
  depthCharts: number
  teamStats: number
  seasonStats: number
  injuries: number
  tradeValues: number
}

type ProviderAvailability = Record<string, { available: boolean; count: number; note: string | null }>

function parseArgs(argv: string[]): Args {
  const now = new Date()
  const out: Args = {
    json: false,
    season: now.getUTCFullYear(),
    week: 1,
    limit: 500,
    skipProviderSync: false,
    write: false,
    dryRun: false,
  }
  for (const raw of argv) {
    if (raw === '--json') out.json = true
    else if (raw === '--skip-provider-sync') out.skipProviderSync = true
    else if (raw === '--write') out.write = true
    else if (raw === '--dry-run') out.dryRun = true
    else if (raw.startsWith('--season=')) {
      const parsed = Number(raw.slice('--season='.length))
      if (Number.isFinite(parsed) && parsed > 2000) out.season = Math.trunc(parsed)
    } else if (raw.startsWith('--week=')) {
      const parsed = Number(raw.slice('--week='.length))
      if (Number.isFinite(parsed) && parsed > 0) out.week = Math.trunc(parsed)
    } else if (raw.startsWith('--limit=')) {
      const parsed = Number(raw.slice('--limit='.length))
      if (Number.isFinite(parsed) && parsed > 0) out.limit = Math.min(Math.trunc(parsed), 10000)
    }
  }
  return out
}

function emptyCounts(): ProviderCounts {
  return {
    teams: 0,
    players: 0,
    schedule: 0,
    depthCharts: 0,
    teamStats: 0,
    seasonStats: 0,
    injuries: 0,
    tradeValues: 0,
  }
}

async function safeProviderCount(
  label: string,
  availability: ProviderAvailability,
  fn: () => Promise<number>,
): Promise<number> {
  try {
    const count = await fn()
    availability[label] = {
      available: count > 0,
      count,
      note: count > 0 ? null : 'provider returned zero rows',
    }
    return count
  } catch (error) {
    availability[label] = {
      available: false,
      count: 0,
      note: error instanceof Error ? error.message : String(error),
    }
    return 0
  }
}

function writeCommand(args: Args): string {
  return [
    'node --env-file=.env --require ./scripts/_audit-preload.cjs --import tsx',
    'scripts/sync-rolling-insights-nfl-foundation.ts',
    '--',
    `--season=${args.season}`,
    `--week=${args.week}`,
    `--limit=${args.limit}`,
    '--write',
    '--json',
  ].join(' ')
}

function auditCommand(args: Args): string {
  return [
    'node --env-file=.env --require ./scripts/_audit-preload.cjs --import tsx',
    'scripts/audit-rolling-insights-nfl-foundation.ts',
    '--',
    `--season=${args.season}`,
    `--week=${args.week}`,
    '--json',
  ].join(' ')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const write = args.write && !args.dryRun
  const mode = write ? 'write' : 'dry-run'
  const writeSafety = write
    ? assertProviderWriteAllowed({
        write,
        targetSport: 'NFL',
        providerMode: 'rolling_insights_nfl_foundation',
      })
    : inspectProviderWriteSafety({
        write,
        targetSport: 'NFL',
        providerMode: 'rolling_insights_nfl_foundation',
      })
  const riSeason = rollingInsightsSeasonRange(args.season)
  const beforeCoverage = await getCanonicalNflDataCoverage({ season: args.season, week: args.week, prismaClient: prisma })
  const providerCounts = emptyCounts()
  const providerAvailability: ProviderAvailability = {}

  let schedule = null
  let seasonStats = null
  let injuries = null

  if (!args.skipProviderSync) {
    if (write) {
      providerCounts.teams = await syncNFLTeamsToDb()
      providerCounts.players = await syncNFLPlayersToDb({ season: riSeason })
      providerCounts.depthCharts = await syncNFLDepthChartsToDb({ season: riSeason })
      providerCounts.teamStats = await syncNFLTeamStatsToDb({ season: riSeason })
      providerAvailability.teams = { available: providerCounts.teams > 0, count: providerCounts.teams, note: null }
      providerAvailability.players = { available: providerCounts.players > 0, count: providerCounts.players, note: null }
      providerAvailability.depthCharts = { available: providerCounts.depthCharts > 0, count: providerCounts.depthCharts, note: null }
      providerAvailability.teamStats = { available: providerCounts.teamStats > 0, count: providerCounts.teamStats, note: null }
    } else {
      const [
        teams,
        players,
        depthCharts,
        teamStats,
        scheduleReport,
        seasonStatsReport,
        injuriesReport,
      ] = await Promise.all([
        safeProviderCount('teams', providerAvailability, async () => (await fetchNFLTeams()).length),
        safeProviderCount('players', providerAvailability, async () => {
          const rows = await fetchNFLRoster({ season: riSeason, limit: args.limit })
          return rows.length
        }),
        safeProviderCount('depthCharts', providerAvailability, async () => {
          const rows = await fetchNFLDepthCharts({ season: riSeason })
          return rows.reduce((sum, chart) => sum + Object.keys(chart.positions).length, 0)
        }),
        safeProviderCount('teamStats', providerAvailability, async () => {
          const rows = await fetchNFLTeamsFull({ season: riSeason })
          return rows.reduce((sum, team) => sum + team.regularSeason.length + team.postSeason.length, 0)
        }),
        syncNflFoundationSchedule({ season: args.season, write, prismaClient: prisma }),
        syncNflFoundationSeasonStats({
          season: args.season,
          write,
          limit: args.limit,
          prismaClient: prisma,
        }),
        syncNflFoundationInjuries({ write, prismaClient: prisma }),
      ])
      providerCounts.teams = teams
      providerCounts.players = players
      providerCounts.depthCharts = depthCharts
      providerCounts.teamStats = teamStats
      schedule = scheduleReport
      seasonStats = seasonStatsReport
      injuries = injuriesReport
    }

    if (write) {
      schedule = await syncNflFoundationSchedule({ season: args.season, write, prismaClient: prisma })
      seasonStats = await syncNflFoundationSeasonStats({
        season: args.season,
        write,
        limit: args.limit,
        prismaClient: prisma,
      })
      injuries = await syncNflFoundationInjuries({ write, prismaClient: prisma })
    }

    if (schedule) {
      providerCounts.schedule = schedule.validForGameSchedule
      providerAvailability.schedule = {
        available: schedule.validForGameSchedule > 0,
        count: schedule.validForGameSchedule,
        note: schedule.validForGameSchedule > 0 ? `selected RI season ${schedule.selectedRollingInsightsSeason}` : 'no schedule rows with week',
      }
    }

    if (seasonStats) {
      providerCounts.seasonStats = seasonStats.writeCandidates
      providerAvailability.seasonStats = {
        available: seasonStats.writeCandidates > 0,
        count: seasonStats.writeCandidates,
        note: seasonStats.writeCandidates > 0 ? null : 'player-stats endpoint returned no usable regular_season rows',
      }
    }

    if (injuries) {
      providerCounts.injuries = injuries.normalizedRows
      providerAvailability.injuries = {
        available: injuries.available,
        count: injuries.normalizedRows,
        note: injuries.error,
      }
    }
  }

  const identity = write
    ? await backfillNflRollingInsightsIdentities({ write: true, prismaClient: prisma })
    : await auditNflRollingInsightsIdentity({ prismaClient: prisma })
  const projections = await generateAndPersistCanonicalNflProjections({
    season: args.season,
    week: args.week,
    limit: args.limit,
    write,
    prismaClient: prisma,
  })
  const afterCoverage = await getCanonicalNflDataCoverage({ season: args.season, week: args.week, prismaClient: prisma })

  providerAvailability.tradeValues = {
    available: false,
    count: 0,
    note: 'FantasyCalc trade values are not a Rolling Insights feed; refresh separately with npm run sync:fantasycalc-valuations.',
  }

  const result = {
    ok: true,
    generatedAt: new Date().toISOString(),
    mode,
    writeModeWasRun: write,
    writeSafety,
    season: args.season,
    week: args.week,
    rollingInsightsSeason: riSeason,
    providerSyncSkipped: args.skipProviderSync,
    providerCounts,
    providerAvailability,
    schedule,
    seasonStats,
    injuries,
    identity,
    projections,
    beforeCoverage,
    afterCoverage,
    beforeCounts: beforeCoverage.counts,
    afterCounts: afterCoverage.counts,
    writeCommand: writeCommand(args),
    auditCommand: auditCommand(args),
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  console.log(`NFL foundation sync ${mode} for season ${args.season}, week ${args.week}`)
  console.log(
    `Write safety: allowed=${writeSafety.allowed} appEnv=${writeSafety.appEnv ?? 'unset'} databaseBranch=${writeSafety.databaseBranch ?? 'unset'} host=${writeSafety.databaseHost ?? 'unset'} database=${writeSafety.databaseName ?? 'unset'}`,
  )
  console.log(`Before counts: ${JSON.stringify(beforeCoverage.counts)}`)
  console.log(`Provider rows: ${JSON.stringify(providerCounts)}`)
  console.log(
    `Identity match rate: ${
      'estimatedMatchRateAfter' in identity ? identity.estimatedMatchRateAfter : identity.matchRate
    }%`,
  )
  console.log(
    `Projections: generated=${projections.generated} weeklyPersisted=${projections.persisted} rosPersisted=${projections.rosPersisted} skipped=${projections.skipped}`,
  )
  console.log(`After counts: ${JSON.stringify(afterCoverage.counts)}`)
  console.log(`Missing after: ${afterCoverage.missingFields.join(', ') || 'none'}`)
  console.log(`Stale after: ${afterCoverage.staleFields.join(', ') || 'none'}`)
  console.log(`Write mode command: ${writeCommand(args)}`)
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
    if (aliasPrisma !== prisma) await aliasPrisma.$disconnect().catch(() => undefined)
    process.exit(process.exitCode ?? 0)
  })
