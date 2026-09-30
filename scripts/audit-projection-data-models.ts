/**
 * Projection data model decision audit.
 * Lists all models that can store or relate to fantasy projections/FPPG,
 * with current row counts and schema analysis.
 */
import { prisma } from '@/lib/prisma'

interface ModelAudit {
  model: string
  rowCount: number
  fields: string[]
  unique: string | string[] | null
  routesRead: string[]
  canStore: boolean
  canBackfill: boolean
  fitScore: number
  notes: string
}

async function main() {
  console.log('[projection-data-model-audit] scanning...\n')

  const audits: ModelAudit[] = []

  // 1. PlayerSeasonStats
  const playerSeasonStatsCount = await prisma.playerSeasonStats.count()
  const playerSeasonStatsNfl = await prisma.playerSeasonStats.count({
    where: { sport: 'NFL', source: 'rolling_insights' },
  })
  audits.push({
    model: 'PlayerSeasonStats',
    rowCount: playerSeasonStatsCount,
    fields: [
      'playerId',
      'sport',
      'season',
      'seasonType',
      'fantasyPoints',
      'fantasyPointsPerGame',
      'source',
      'stats (Json)',
    ],
    unique: '[sport, playerId, season, seasonType, source]',
    routesRead: ['lib/draft/analytics/nfl-rolling-insights-draft-analytics.ts'],
    canStore: true,
    canBackfill: false,
    fitScore: 100,
    notes: `SOURCE OF TRUTH for projection data. NFL/RI subset: ${playerSeasonStatsNfl} rows. Indexed by [sport, playerId]. Routes already read this model. Perfect candidate for joining draft pool rows via RI identity lookup.`,
  })

  // 2. SportsPlayerRecord.projections
  const sportsPlayerRecordCount = await prisma.sportsPlayerRecord.count()
  audits.push({
    model: 'SportsPlayerRecord (projections field)',
    rowCount: sportsPlayerRecordCount,
    fields: ['id (VarChar 128)', 'sport', 'name', 'position', 'team', 'projections (Json)', 'stats (Json)'],
    unique: 'id (composite key with sport)',
    routesRead: [
      'lib/draft-room/getResolvedDraftPoolForLeague.ts',
      'multiple routes',
    ],
    canStore: true,
    canBackfill: true,
    fitScore: 65,
    notes: `Main player cache. Projections field exists as Json. Could backfill computed projections Json. Joining to pool by name+position is less reliable than playerId. Used extensively by draft pool resolver.`,
  })

  // 3. AFProjectionSnapshot
  const afProjCount = await prisma.aFProjectionSnapshot.count()
  const afProjNfl = await prisma.aFProjectionSnapshot.count({ where: { sport: 'NFL' } })
  audits.push({
    model: 'AFProjectionSnapshot',
    rowCount: afProjCount,
    fields: [
      'playerId',
      'playerName',
      'sport',
      'week',
      'season',
      'afProjection',
      'baselineProjection',
      'confidenceLevel',
    ],
    unique: 'snapshotLookupKey (per-week, per-event)',
    routesRead: [
      'lib/draft-room/getResolvedDraftPoolForLeague.ts (lookup)',
    ],
    canStore: false,
    canBackfill: false,
    fitScore: 20,
    notes: `AI/AF-specific projections. Week-scoped (${afProjNfl} NFL rows). Limited to weeks with AI computation. Cannot store season-wide FPPG values. Not suitable for general projection backfill.`,
  })

  // 4. PlayerAnalyticsSnapshot
  const playerAnalyticsCount = await prisma.playerAnalyticsSnapshot.count()
  audits.push({
    model: 'PlayerAnalyticsSnapshot',
    rowCount: playerAnalyticsCount,
    fields: [
      'normalizedName',
      'name',
      'position',
      'season',
      'fantasyPointsPerGame',
      'expectedFantasyPoints',
      'athleticism metrics (20+ fields)',
    ],
    unique: '[normalizedName, season, source]',
    routesRead: ['lib/draft-room/getResolvedDraftPoolForLeague.ts (analytics lookup)'],
    canStore: true,
    canBackfill: true,
    fitScore: 15,
    notes: `College combine + season analytics. UNIQUE constraint on [normalizedName, season, source] — NOT playerId. Empty (${playerAnalyticsCount} rows). Collision risk: many players share normalized names. Does not join cleanly to pool rows by playerId. Wrong fit for pro season projections.`,
  })

  // 5. AllFantasyAdpSnapshot
  const afAdpCount = await prisma.allFantasyAdpSnapshot.count()
  audits.push({
    model: 'AllFantasyAdpSnapshot',
    rowCount: afAdpCount,
    fields: ['playerKey (normalized name|position)', 'playerName', 'sport', 'season', 'averageOverallPick'],
    unique: '[playerKey, contextHash, draftMode]',
    routesRead: ['lib/draft-room/getResolvedDraftPoolForLeague.ts (ADP only)'],
    canStore: false,
    canBackfill: false,
    fitScore: 0,
    notes: `ADP consensus only. No FPPG or projection fields. Not applicable for projection backfill.`,
  })

  // 6. DraftPoolCache
  const draftPoolCacheCount = await prisma.draftPoolCache.count()
  audits.push({
    model: 'DraftPoolCache',
    rowCount: draftPoolCacheCount,
    fields: ['leagueId', 'cacheKey', 'payload (Json: resolved pool)', 'syncedAt'],
    unique: 'cacheKey',
    routesRead: ['GET /api/leagues/:leagueId/draft/pool'],
    canStore: false,
    canBackfill: false,
    fitScore: 0,
    notes: `Cache table, not source of truth. Stores resolved pool as JSON. Regenerated on warm. Not suitable for backfill operations.`,
  })

  // Print report
  console.log('═══════════════════════════════════════════════════════════════\n')
  console.log('PROJECTION/STATS DATA MODEL AUDIT\n')

  for (const audit of audits.sort((a, b) => b.fitScore - a.fitScore)) {
    console.log(`${audit.model.toUpperCase()}`)
    console.log(`  Row count: ${audit.rowCount}`)
    console.log(`  Fit score: ${audit.fitScore}/100`)
    console.log(`  Can store: ${audit.canStore ? 'YES' : 'NO'} | Can backfill: ${audit.canBackfill ? 'YES' : 'NO'}`)
    console.log(`  Read by: ${audit.routesRead.join(', ')}`)
    console.log(`  Unique: ${typeof audit.unique === 'string' ? audit.unique : audit.unique?.join(', ')}`)
    console.log(`  Note: ${audit.notes}`)
    console.log()
  }

  console.log('═══════════════════════════════════════════════════════════════\n')
  console.log('RECOMMENDATION\n')

  const topFit = audits.sort((a, b) => b.fitScore - a.fitScore)[0]
  console.log(`Recommended target: ${topFit.model}`)
  console.log(`Reason: ${topFit.notes}`)

  await prisma.$disconnect()
}

main()
  .catch((err) => {
    console.error('[projection-data-model-audit] FAILED:', err)
    process.exit(1)
  })
