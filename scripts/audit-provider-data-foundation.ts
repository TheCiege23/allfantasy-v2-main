/**
 * Read-only provider foundation audit for redraft NFL/NCAAF normalized data.
 *
 * Usage:
 *   node --env-file=.env.redraft-test --require ./scripts/_audit-preload.cjs --import tsx scripts/audit-provider-data-foundation.ts -- --season=2026 --week=1 --json
 */

import { prisma } from '../lib/prisma'
import { prisma as aliasPrisma } from '@/lib/prisma'
import { getCanonicalNflDataCoverage } from '../lib/nfl-data-foundation/nflDataCoverage'
import { auditNflRollingInsightsIdentity } from '../lib/nfl-data-foundation/nflFoundationSync'
import { getProviderMediaCoverage } from '../lib/provider-data-foundation/providerMediaAssets'
import { inspectProviderWriteSafety } from '../lib/provider-data-foundation/writeSafety'

type Args = {
  json: boolean
  season: number
  week: number | null
}

function parseArgs(argv: string[]): Args {
  const out: Args = { json: false, season: new Date().getUTCFullYear(), week: null }
  for (const raw of argv) {
    if (raw === '--json') out.json = true
    else if (raw.startsWith('--season=')) {
      const parsed = Number(raw.slice('--season='.length))
      if (Number.isFinite(parsed) && parsed > 2000) out.season = Math.trunc(parsed)
    } else if (raw.startsWith('--week=')) {
      const parsed = Number(raw.slice('--week='.length))
      if (Number.isFinite(parsed) && parsed > 0) out.week = Math.trunc(parsed)
    }
  }
  return out
}

async function count(model: unknown, args: Record<string, unknown>): Promise<number> {
  const fn = (model as { count?: Function } | null)?.count
  if (!fn) return 0
  return Number((await fn(args).catch(() => 0)) ?? 0)
}

async function latest(model: unknown, where: Record<string, unknown>, dateField: string): Promise<string | null> {
  const fn = (model as { findFirst?: Function } | null)?.findFirst
  if (!fn) return null
  const row = await fn({
    where,
    orderBy: { [dateField]: 'desc' },
    select: { [dateField]: true },
  }).catch(() => null)
  const value = row?.[dateField]
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null
}

async function ncaafAudit(season: number, week: number | null) {
  const seasonString = String(season)
  const afWeeklyWhere = week != null ? { sport: 'NCAAF', season, week } : { sport: 'NCAAF', season, week: { not: null } }
  const [
    players,
    teams,
    schedules,
    sportsGames,
    seasonStats,
    teamStats,
    injuries,
    weeklyProjections,
    rosProjections,
    identityRows,
    identityWithProvider,
    duplicateCandidateGroups,
    latestPlayers,
    latestTeams,
    latestSchedules,
    latestSeasonStats,
    latestWeeklyProjection,
  ] = await Promise.all([
    count(prisma.sportsPlayer, { where: { sport: 'NCAAF' } }),
    count(prisma.sportsTeam, { where: { sport: 'NCAAF' } }),
    count((prisma as any).gameSchedule, { where: { sportType: 'NCAAF', season } }),
    count(prisma.sportsGame, { where: { sport: 'NCAAF', season } }),
    count(prisma.playerSeasonStats, { where: { sport: 'NCAAF', season: seasonString, seasonType: 'regular' } }),
    count(prisma.teamSeasonStats, { where: { sport: 'NCAAF', season: seasonString, seasonType: 'regular' } }),
    count(prisma.sportsInjury, { where: { sport: 'NCAAF' } }),
    count(prisma.aFProjectionSnapshot, { where: afWeeklyWhere }),
    count(prisma.aFProjectionSnapshot, { where: { sport: 'NCAAF', season, week: null } }),
    count(prisma.playerIdentityMap, { where: { sport: 'NCAAF' } }),
    count(prisma.playerIdentityMap, {
      where: {
        sport: 'NCAAF',
        OR: [
          { apiSportsId: { not: null } },
          { rollingInsightsId: { not: null } },
          { espnId: { not: null } },
          { clearSportsId: { not: null } },
        ],
      },
    }),
    prisma.sportsPlayer
      .findMany({
        where: { sport: 'NCAAF' },
        select: { name: true, position: true, team: true },
        take: 10000,
      })
      .then((rows) => {
        const groups = new Map<string, number>()
        for (const row of rows) {
          const key = `${row.name.toLowerCase()}|${String(row.position ?? '').toUpperCase()}|${String(row.team ?? '').toUpperCase()}`
          groups.set(key, (groups.get(key) ?? 0) + 1)
        }
        return [...groups.values()].filter((value) => value > 1).length
      })
      .catch(() => 0),
    latest(prisma.sportsPlayer, { sport: 'NCAAF' }, 'fetchedAt'),
    latest(prisma.sportsTeam, { sport: 'NCAAF' }, 'fetchedAt'),
    latest((prisma as any).gameSchedule, { sportType: 'NCAAF', season }, 'updatedAt'),
    latest(prisma.playerSeasonStats, { sport: 'NCAAF', season: seasonString }, 'fetchedAt'),
    latest(prisma.aFProjectionSnapshot, afWeeklyWhere, 'computedAt'),
  ])

  const missingFields = [
    players <= 0 ? 'players' : null,
    teams <= 0 ? 'teams' : null,
    schedules <= 0 && sportsGames <= 0 ? 'schedule' : null,
    seasonStats <= 0 ? 'player season stats' : null,
    weeklyProjections <= 0 ? 'weekly projections' : null,
    rosProjections <= 0 ? 'ROS projections' : null,
  ].filter((value): value is string => Boolean(value))

  const unavailableProviderFields = [
    'CFBD fantasy projections unavailable; use labeled AllFantasy fallback snapshots.',
    'CFBD injuries unavailable in this integration; do not fabricate injury rows.',
    'CFBD team rankings are not fantasy ADP.',
  ]

  return {
    sport: 'NCAAF',
    season,
    week,
    counts: {
      players,
      teams,
      schedules,
      sportsGames,
      seasonStats,
      teamStats,
      injuries,
      weeklyProjections,
      rosProjections,
      identityRows,
      identityWithProvider,
      duplicateCandidateGroups,
    },
    lastFetchedAt: {
      players: latestPlayers,
      teams: latestTeams,
      schedules: latestSchedules,
      seasonStats: latestSeasonStats,
      weeklyProjections: latestWeeklyProjection,
    },
    identityMatchRate: players > 0 ? Math.round((identityWithProvider / players) * 1000) / 10 : 0,
    missingFields,
    unavailableProviderFields,
  }
}

function ncaafWriteCommand(args: Args): string {
  return [
    'node --env-file=.env.redraft-test --require ./scripts/_audit-preload.cjs --import tsx',
    'scripts/sync-ncaaf-cfbd-foundation.ts',
    '--',
    `--season=${args.season}`,
    args.week ? `--week=${args.week}` : '--week=1',
    '--write',
    '--json',
  ].join(' ')
}

function mediaWriteCommand(): string {
  return [
    'node --env-file=.env.redraft-test --require ./scripts/_audit-preload.cjs --import tsx',
    'scripts/sync-provider-media-assets.ts',
    '--',
    '--sport=ALL',
    '--limit=250',
    '--write',
    '--json',
  ].join(' ')
}

async function checkDatabaseReachability(): Promise<{ reachable: boolean; error: string | null }> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return { reachable: true, error: null }
  } catch (error) {
    return {
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const database = await checkDatabaseReachability()
  const writeSafetyDryRun = inspectProviderWriteSafety({
    write: false,
    targetSport: 'ALL',
    providerMode: 'provider_data_foundation_audit',
  })

  if (!database.reachable) {
    const result = {
      ok: false,
      generatedAt: new Date().toISOString(),
      readOnly: true,
      season: args.season,
      week: args.week,
      blocked: 'database_unreachable',
      database,
      writeSafetyDryRun,
      writeCommands: {
        ncaaf: ncaafWriteCommand(args),
        media: mediaWriteCommand(),
      },
    }
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log(`Provider foundation audit blocked: database unreachable (${database.error ?? 'unknown error'})`)
    console.log(`NCAAF write command=${ncaafWriteCommand(args)}`)
    console.log(`Media write command=${mediaWriteCommand()}`)
    return
  }

  const [nflCoverage, nflIdentity, ncaaf, nflMedia, ncaafMedia] = await Promise.all([
    getCanonicalNflDataCoverage({ season: args.season, week: args.week, prismaClient: prisma }),
    auditNflRollingInsightsIdentity({ prismaClient: prisma }),
    ncaafAudit(args.season, args.week),
    getProviderMediaCoverage({ sport: 'NFL', db: prisma }),
    getProviderMediaCoverage({ sport: 'NCAAF', db: prisma }),
  ])
  const result = {
    ok: true,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    season: args.season,
    week: args.week,
    database,
    writeSafetyDryRun,
    nfl: {
      coverage: nflCoverage,
      identityAudit: nflIdentity,
      normalizedSurfaces: [
        'SportsPlayer',
        'SportsTeam',
        'GameSchedule',
        'DepthChart',
        'PlayerSeasonStats',
        'SportsInjury',
        'FantasyProjection',
        'AFProjectionSnapshot',
        'SportsPlayerRecord trade values',
      ],
    },
    ncaaf,
    media: {
      NFL: nflMedia,
      NCAAF: ncaafMedia,
    },
    uiAiConsumers: [
      'draft room',
      'mock draft room',
      'players tab',
      'waiver wire',
      'trade center',
      'War Room',
      'commissioner hub',
      'Chimmy grounding context',
    ],
    writeCommands: {
      ncaaf: ncaafWriteCommand(args),
      media: mediaWriteCommand(),
    },
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  console.log(`Provider foundation audit for season ${args.season}${args.week ? ` week ${args.week}` : ''}`)
  console.log(`NFL counts=${JSON.stringify(nflCoverage.counts)} missing=${nflCoverage.missingFields.join(', ') || 'none'} stale=${nflCoverage.staleFields.join(', ') || 'none'}`)
  console.log(`NFL RI identity match=${nflIdentity.matchRate}% duplicateGroups=${nflIdentity.duplicateCandidateGroups}`)
  console.log(`NCAAF counts=${JSON.stringify(ncaaf.counts)} missing=${ncaaf.missingFields.join(', ') || 'none'}`)
  console.log(`NFL media=${JSON.stringify(nflMedia)}`)
  console.log(`NCAAF media=${JSON.stringify(ncaafMedia)}`)
  console.log(`NCAAF write command=${ncaafWriteCommand(args)}`)
  console.log(`Media write command=${mediaWriteCommand()}`)
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
