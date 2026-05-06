/**
 * Read-only gap audit over cached `sports_players` rows — complementary to coverage aggregates.
 *
 * Usage:
 *   npm run data:audit-provider-gaps -- --sport NFL --domain stats --limit 20
 *   npm run data:audit-provider-gaps -- --sport SOCCER --league EPL --domain team --limit 10 --json
 */

import { prisma } from '@/lib/prisma'
import {
  aggregatePlayerRecordCoverage,
  formatCoverageReport,
  type CoverageSportArg,
  type PlayerRecordCoverageRow,
} from '@/lib/providers/providerDataCoverage'
import { normalizeSoccerLeague, type RollingInsightsSoccerLeagueCode } from '@/lib/providers/rollingInsightsSoccerLeague'

type GapDomain = 'stats' | 'injuries' | 'images' | 'adp' | 'experience' | 'live' | 'schedule' | 'team' | 'all'
type SurfaceArg = 'draft' | 'waivers' | 'roster' | 'trade' | 'ai' | 'matchup' | 'none'

function parseArgs(argv: string[]) {
  let sport: CoverageSportArg = 'NFL'
  let limit = 50
  let json = false
  let domain: GapDomain = 'all'
  let surface: SurfaceArg = 'none'
  let soccerLeague: RollingInsightsSoccerLeagueCode | null = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--sport' && argv[i + 1]) sport = argv[++i] as CoverageSportArg
    else if (a === '--limit' && argv[i + 1]) limit = Math.min(5000, Math.max(1, Number(argv[++i]) || 50))
    else if (a === '--json') json = true
    else if (a === '--surface' && argv[i + 1]) {
      const s = argv[++i]
      if (
        s === 'draft' ||
        s === 'waivers' ||
        s === 'roster' ||
        s === 'trade' ||
        s === 'ai' ||
        s === 'matchup'
      ) {
        surface = s
      }
    } else if (a === '--domain' && argv[i + 1]) {
      const d = argv[++i] as GapDomain
      if (
        d === 'stats' ||
        d === 'injuries' ||
        d === 'images' ||
        d === 'adp' ||
        d === 'experience' ||
        d === 'live' ||
        d === 'schedule' ||
        d === 'team' ||
        d === 'all'
      ) {
        domain = d
      }
    } else if (a === '--league' && argv[i + 1]) {
      soccerLeague = normalizeSoccerLeague(argv[++i])
    }
  }
  return { sport, limit, json, domain, surface, soccerLeague }
}

async function main() {
  const { sport, limit, json, domain, surface, soccerLeague } = parseArgs(process.argv.slice(2))

  const sportDb =
    sport === 'NCAABB' || sport === 'NCAAB'
      ? 'NCAAB'
      : sport === 'NCAAFB'
        ? 'NCAAF'
        : sport === 'EPL' || sport === 'LALIGA' || sport === 'SERIEA'
          ? 'SOCCER'
          : sport

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
      adp: true,
      headshotUrl: true,
      headshotUrlLg: true,
    },
    take: limit,
    orderBy: { lastUpdated: 'desc' },
  })

  const mapped: PlayerRecordCoverageRow[] = rows.map((r) => ({
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
  const agg = aggregatePlayerRecordCoverage(mapped, sport, covOpts)

  const domainNotes: string[] = []
  if (domain === 'stats' || domain === 'all') {
    domainNotes.push(
      `domain.stats coverage statsJson=${agg.withStatsJson}/${agg.total} teamSeasonStatSignals=${agg.rowsWithTeamSeasonStatSignals}`,
    )
  }
  if (domain === 'injuries' || domain === 'all') {
    domainNotes.push(`domain.injuries keywordSignals=${agg.rowsWithInjuryKeywordSignals}/${agg.total}`)
  }
  if (domain === 'images' || domain === 'all') {
    domainNotes.push(`domain.images headshot=${agg.withImages}/${agg.total}`)
  }
  if (domain === 'experience' || domain === 'all') {
    domainNotes.push(`domain.experience rookieHints=${agg.withRookieSignals} experienceHints=${agg.withExperienceSignals}`)
  }
  if (domain === 'schedule' || domain === 'all') {
    domainNotes.push(`domain.schedule signals=${agg.rowsWithScheduleSignals}`)
  }
  if (domain === 'team' || domain === 'all') {
    domainNotes.push(`domain.team rowsWithTeam=${agg.withTeam}`)
  }
  if (domain === 'adp' || domain === 'all') {
    domainNotes.push(
      `domain.adp note=cache.adp on sports_players is sparse — primary ADP remains league pool / imports / AI ADP`,
    )
  }
  if (domain === 'live' || domain === 'all') {
    domainNotes.push(`domain.live note=no dedicated live flag in this aggregate — use Rolling Insights live ingest paths`)
  }

  const report = {
    sport,
    sportDb,
    surface,
    domain,
    soccerLeague,
    aggregate: agg,
    domainNotes,
    textReport: [formatCoverageReport(agg, sport), ...domainNotes].join('\n'),
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(report.textReport)
    if (surface !== 'none') console.log(`surface=${surface} (informational — same DB scan)`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
