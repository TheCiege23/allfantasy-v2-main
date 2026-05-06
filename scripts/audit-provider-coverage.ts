/**
 * Read-only provider coverage audit over sports_players projection cache.
 *
 * Usage:
 *   npx tsx scripts/audit-provider-coverage.ts --sport NFL --limit 20
 *   npx tsx scripts/audit-provider-coverage.ts --sport NFL --provider clearsports --limit 20
 *   npx tsx scripts/audit-provider-coverage.ts --sport NCAAFB --missing class --limit 10 --json
 */

import { prisma } from '@/lib/prisma'
import {
  aggregatePlayerRecordCoverage,
  filterRowsMissing,
  formatCoverageReport,
  type CoverageSportArg,
  type MissingCoverageFlag,
  type PlayerRecordCoverageRow,
} from '@/lib/providers/providerDataCoverage'
import { inferExperienceSourceFromDataSource } from '@/lib/player-data/providerExperienceFields'

type ProviderFilterArg = 'all' | 'rolling_insights' | 'thesportsdb' | 'clearsports'

function parseArgs(argv: string[]) {
  let sport: CoverageSportArg = 'NFL'
  let limit = 50
  let json = false
  let missing: MissingCoverageFlag | null = null
  let soccerLeague: string | null = null
  let provider: ProviderFilterArg = 'all'
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--sport' && argv[i + 1]) {
      sport = argv[++i] as CoverageSportArg
    } else if (a === '--league' && argv[i + 1]) {
      soccerLeague = argv[++i]
    } else if (a === '--limit' && argv[i + 1]) {
      limit = Math.min(5000, Math.max(1, Number(argv[++i]) || 50))
    } else if (a === '--json') {
      json = true
    } else if (a === '--missing' && argv[i + 1]) {
      const m = argv[++i]
      if (
        m === 'rookie' ||
        m === 'stats' ||
        m === 'projections' ||
        m === 'class' ||
        m === 'schedule' ||
        m === 'team_stats' ||
        m === 'player_info' ||
        m === 'team_info'
      ) {
        missing = m
      }
    } else if (a === '--provider' && argv[i + 1]) {
      const p = String(argv[++i]).toLowerCase()
      if (p === 'all' || p === 'rolling_insights' || p === 'thesportsdb' || p === 'clearsports') {
        provider = p as ProviderFilterArg
      }
    }
  }
  return { sport, limit, json, missing, soccerLeague, provider }
}

async function main() {
  const { sport, limit, json, missing, soccerLeague, provider } = parseArgs(process.argv.slice(2))

  const sportDb =
    sport === 'NCAABB' || sport === 'NCAAB'
      ? 'NCAAB'
      : sport === 'NCAAFB'
        ? 'NCAAF'
        : sport === 'EPL' || sport === 'LALIGA' || sport === 'SERIEA'
          ? 'SOCCER'
          : sport

  const fetchCap = provider === 'all' ? limit : Math.min(5000, Math.max(limit * 40, limit))

  const rows = await prisma.sportsPlayerRecord.findMany({
    where: { sport: sportDb },
    select: {
      id: true,
      name: true,
      sport: true,
      team: true,
      position: true,
      stats: true,
      projections: true,
      news: true,
      dataSource: true,
      headshotUrl: true,
      headshotUrlLg: true,
    },
    take: fetchCap,
    orderBy: { lastUpdated: 'desc' },
  })

  const filteredRows = rows.filter((r) => {
    if (provider === 'all') return true
    return inferExperienceSourceFromDataSource(String(r.dataSource ?? '')) === provider
  })

  const mapped: PlayerRecordCoverageRow[] = filteredRows.slice(0, limit).map((r) => ({
    id: r.id,
    name: r.name,
    sport: r.sport,
    team: r.team,
    position: r.position,
    stats: r.stats,
    projections: r.projections,
    news: r.news,
    dataSource: r.dataSource,
    headshotUrl: r.headshotUrl,
    headshotUrlLg: r.headshotUrlLg,
  }))

  const covOpts = soccerLeague ? { soccerLeague } : undefined
  let agg = aggregatePlayerRecordCoverage(mapped, sport, covOpts)
  if (missing) {
    const miss = filterRowsMissing(mapped, missing, sport, covOpts)
    agg = { ...agg, sampleMissing: miss }
  }

  if (json) {
    console.log(JSON.stringify(agg, null, 2))
  } else {
    console.log(formatCoverageReport(agg, sport))
    if (agg.sampleMissing?.length) {
      console.log('\nSample missing (first %d):', agg.sampleMissing.length)
      for (const s of agg.sampleMissing.slice(0, 5)) {
        console.log('-', s.id, s.name, s.position, s.team)
      }
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
