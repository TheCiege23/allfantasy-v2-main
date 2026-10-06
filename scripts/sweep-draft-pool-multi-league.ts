/**
 * Multi-league draft pool data-quality regression sweep.
 *
 * Scans every leagueId that has a DraftPoolCache row and runs the same
 * 11-check regression + identity collision audit in-process.  For leagues
 * that have NO cache row it reports them as `needs_cache_warm` so they can be
 * warmed and re-swept separately.
 *
 * Usage:
 *   npx tsx scripts/sweep-draft-pool-multi-league.ts            # all cached leagues
 *   npx tsx scripts/sweep-draft-pool-multi-league.ts --json     # machine-readable JSON
 *   npx tsx scripts/sweep-draft-pool-multi-league.ts --verbose  # print per-row details
 *
 * npm shortcut:
 *   npm run draft-pool:sweep-multi-league
 *
 * Read-only.  No writes, no external API calls.
 */

import { PrismaClient } from '@prisma/client'
import { canonicalName, canonicalPosition, canonicalTeam } from '../lib/draft-room/player-canonical-identity'

const prisma = new PrismaClient()

type Args = { json: boolean; verbose: boolean; days: number }

function parseArgs(argv: string[]): Args {
  const daysArg = argv.find((a) => a.startsWith('--days='))
  const days = daysArg ? Number(daysArg.slice('--days='.length)) : 14
  return {
    json: argv.includes('--json'),
    verbose: argv.includes('--verbose'),
    days: Number.isFinite(days) && days > 0 ? days : 14,
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

type AnyObj = Record<string, unknown>

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

function num(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return v
}

function boolOrNull(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  return null
}

function readPath(obj: AnyObj, path: string[]): unknown {
  let cur: unknown = obj
  for (const s of path) {
    if (!cur || typeof cur !== 'object') return null
    cur = (cur as AnyObj)[s]
  }
  return cur
}

function isFreeAgentTeam(team: string | null): boolean {
  const t = String(team ?? '').trim().toUpperCase()
  return !t || t === 'FA' || t === 'F/A' || t === 'N/A' || t === 'NONE'
}

function isValidSleeperId(value: string | null | undefined): boolean {
  return /^\d{3,}$/.test(String(value ?? '').trim())
}

// ── Draft pool cache entry parsing ────────────────────────────────────────────

type PoolRow = {
  name: string
  position: string
  team: string | null
  playerId: string | null
  sleeperId: string | null
  fantasyPointsPerGame: number | null
  projectionSource: string | null
  rollingInsightsSupplementalFppg: number | null
  yearsExp: number | null
  isRookie: boolean | null
  headshotUrl: string | null
  teamLogoUrl: string | null
}

function toPoolRows(payload: unknown): PoolRow[] {
  if (!payload || typeof payload !== 'object') return []
  const entries = Array.isArray((payload as AnyObj).entries)
    ? ((payload as AnyObj).entries as unknown[])
    : []

  return entries
    .filter((entry): entry is AnyObj => Boolean(entry && typeof entry === 'object'))
    .map((entry) => {
      const stats = readPath(entry, ['display', 'stats']) as AnyObj | null
      const assets = readPath(entry, ['display', 'assets']) as AnyObj | null
      const supplemental = stats ? (stats.rollingInsightsSupplemental as AnyObj | null) : null

      const playerId = str(entry.playerId) ?? str(readPath(entry, ['display', 'playerId']))
      const sleeperIdRaw = str((entry as AnyObj).sleeperId)
      const sleeperId = sleeperIdRaw ?? (isValidSleeperId(playerId) ? playerId : null)

      return {
        name: str(entry.name) ?? str(readPath(entry, ['display', 'displayName'])) ?? 'unknown',
        position: str(entry.position) ?? str(readPath(entry, ['display', 'metadata', 'position'])) ?? '',
        team: str(entry.team) ?? str(readPath(entry, ['display', 'team', 'abbreviation'])) ?? null,
        playerId: playerId ?? null,
        sleeperId: sleeperId ?? null,
        fantasyPointsPerGame: num(stats?.fantasyPointsPerGame),
        projectionSource: str(entry.projectionSource) ?? str(stats?.projectionSource),
        rollingInsightsSupplementalFppg: num(supplemental?.fantasyPointsPerGame),
        yearsExp: num(entry.yearsExp),
        isRookie: boolOrNull(entry.isRookie),
        headshotUrl: str(assets?.headshotUrl) ?? null,
        teamLogoUrl: str(assets?.teamLogoUrl) ?? null,
      }
    })
}

function matchRows(rows: PoolRow[], name: string): PoolRow[] {
  const target = canonicalName(name)
  return rows.filter((row) => canonicalName(row.name) === target)
}

function uniqueNonNull(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === 'string' && v.trim().length > 0))]
}

// ── Regression checks (same logic as regression-draft-pool-data-quality.ts) ──

type FailureDetail = {
  check: string
  severity: 'error' | 'warning'
  classification: 'backfill_resolvable' | 'needs_cache_rebuild' | 'needs_code_fix' | 'needs_manual_review' | 'info'
  detail?: string
}

const COLLISION_PAIRS: Array<[string, string]> = [
  ['Kenneth Walker III', 'Gabe Davis'],
  ["Dont'e Thornton Jr.", 'Irvin Charles'],
  ['Brevin Jordan', 'Mitchell Tinsley'],
  ['Adam Trautman', 'Velus Jones Jr.'],
  ['Austin Hooper', 'Josh Gable'],
]

type LeagueMetrics = {
  entryCount: number
  duplicatePlayerIdGroups: number
  knownPairCollisionViolations: number
  missingHeadshots: number
  trueMissingTeamLogos: number
  missingProjectionCount: number
  fallbackProjectionCount: number
  fallbackBySource: Record<string, number>
  taggedRealRows: number
  rookieSignalCoveragePct: number
  identityMissingSleeperCarryForward: number
  duplicateSleeperIdGroups: number
}

async function evaluateLeague(
  leagueId: string,
  cachePayload: unknown,
  cacheEntryCount: number,
): Promise<{ metrics: LeagueMetrics; pass: boolean; failures: FailureDetail[] }> {
  const rows = toPoolRows(cachePayload)
  const failures: FailureDetail[] = []

  // duplicate playerId groups
  const byPlayerId = new Map<string, PoolRow[]>()
  for (const row of rows) {
    if (!row.playerId) continue
    const list = byPlayerId.get(row.playerId) ?? []
    list.push(row)
    byPlayerId.set(row.playerId, list)
  }
  const dupPlayerIdGroups = [...byPlayerId.entries()].filter(([, g]) => g.length > 1)

  if (dupPlayerIdGroups.length > 0) {
    failures.push({
      check: 'duplicate_player_id_groups',
      severity: 'error',
      classification: 'needs_code_fix',
      detail: `${dupPlayerIdGroups.length} group(s): ${dupPlayerIdGroups.slice(0, 3).map(([k]) => k).join(', ')}`,
    })
  }

  // duplicate sleeperId groups
  const bySleeperId = new Map<string, PoolRow[]>()
  for (const row of rows) {
    if (!row.sleeperId) continue
    const list = bySleeperId.get(row.sleeperId) ?? []
    list.push(row)
    bySleeperId.set(row.sleeperId, list)
  }
  const dupSleeperIdGroups = [...bySleeperId.entries()].filter(([, g]) => g.length > 1)
  if (dupSleeperIdGroups.length > 0) {
    failures.push({
      check: 'duplicate_sleeper_id_groups',
      severity: 'error',
      classification: 'needs_code_fix',
      detail: `${dupSleeperIdGroups.length} group(s)`,
    })
  }

  // known collision pairs
  let pairCollisionViolations = 0
  for (const [leftName, rightName] of COLLISION_PAIRS) {
    const leftIds = new Set(uniqueNonNull(matchRows(rows, leftName).map((r) => r.playerId)))
    const rightIds = new Set(uniqueNonNull(matchRows(rows, rightName).map((r) => r.playerId)))
    if ([...leftIds].some((id) => rightIds.has(id))) pairCollisionViolations++
  }
  if (pairCollisionViolations > 0) {
    failures.push({
      check: 'known_pair_collision_violations',
      severity: 'error',
      classification: 'needs_code_fix',
      detail: `${pairCollisionViolations} pair(s) share a playerId`,
    })
  }

  // Marvin Harrison Jr / non-Jr distinct
  const jrRows = matchRows(rows, 'Marvin Harrison Jr.')
  const nonJrRows = matchRows(rows, 'Marvin Harrison')
  if (jrRows.length === 0 || nonJrRows.length === 0) {
    failures.push({
      check: 'marvin_jr_non_jr_distinct',
      severity: 'warning',
      classification: 'needs_cache_rebuild',
      detail: `Jr rows=${jrRows.length} non-Jr rows=${nonJrRows.length}`,
    })
  } else {
    const jrIds = new Set(uniqueNonNull(jrRows.map((r) => r.playerId)))
    const nonJrIds = new Set(uniqueNonNull(nonJrRows.map((r) => r.playerId)))
    if ([...jrIds].some((id) => nonJrIds.has(id))) {
      failures.push({
        check: 'marvin_jr_non_jr_id_collision',
        severity: 'error',
        classification: 'needs_code_fix',
      })
    }
  }

  // Russell Wilson sleeperId pin
  const russell = matchRows(rows, 'Russell Wilson')
  if (russell.length !== 1 || (russell[0]?.sleeperId ?? null) !== '1234') {
    failures.push({
      check: 'russell_wilson_sleeper_id_1234',
      severity: 'error',
      classification: 'backfill_resolvable',
      detail: `rows=${russell.length} sleeperId=${russell[0]?.sleeperId ?? 'null'}`,
    })
  }

  // De'Von Achane sleeperId pin. 9226, NOT 7373: PlayerIdentityMap has 7373 as Gus Cumberlander
  // (DL, NO). The old 7373 pin failed this check in nearly every league.
  const achane = matchRows(rows, "De'Von Achane")
  if (achane.length !== 1 || (achane[0]?.sleeperId ?? null) !== '9226') {
    failures.push({
      check: 'devon_achane_sleeper_id_9226',
      severity: 'error',
      classification: 'backfill_resolvable',
      detail: `rows=${achane.length} sleeperId=${achane[0]?.sleeperId ?? 'null'}`,
    })
  }

  // missing headshots
  const missingHeadshots = rows.filter((r) => !r.headshotUrl).length
  if (missingHeadshots > 0) {
    failures.push({
      check: 'missing_headshots',
      severity: 'error',
      classification: 'needs_code_fix',
      detail: `${missingHeadshots} rows`,
    })
  }

  // true missing team logos
  const trueMissingTeamLogos = rows.filter((r) => !isFreeAgentTeam(r.team) && !r.teamLogoUrl).length
  if (trueMissingTeamLogos > 0) {
    failures.push({
      check: 'true_missing_team_logos',
      severity: 'error',
      classification: 'needs_code_fix',
      detail: `${trueMissingTeamLogos} rows`,
    })
  }

  // missing projections
  const missingProjectionCount = rows.filter((r) => r.fantasyPointsPerGame == null).length
  const fallbackRows = rows.filter((r) => r.projectionSource != null)
  const fallbackBySource = fallbackRows.reduce((acc, row) => {
    const key = row.projectionSource as string
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  if (missingProjectionCount > 0) {
    failures.push({
      check: 'missing_projections',
      severity: 'error',
      classification: 'needs_code_fix',
      detail: `${missingProjectionCount} rows missing fantasyPointsPerGame`,
    })
  }

  // fallback rows have projectionSource
  const fallbackMissingSource = fallbackRows.filter((r) => !r.projectionSource).length
  if (fallbackMissingSource > 0) {
    failures.push({
      check: 'fallback_rows_missing_projection_source',
      severity: 'error',
      classification: 'needs_code_fix',
      detail: `${fallbackMissingSource} fallback rows lack projectionSource`,
    })
  }

  // real projection rows not fallback-tagged
  const taggedRealRows = rows.filter(
    (r) => r.projectionSource != null && r.rollingInsightsSupplementalFppg != null,
  ).length
  if (taggedRealRows > 0) {
    failures.push({
      check: 'real_projection_rows_not_fallback_tagged',
      severity: 'error',
      classification: 'needs_code_fix',
      detail: `${taggedRealRows} real rows incorrectly have projectionSource`,
    })
  }

  // rookie signal coverage
  const rookieRelevant = rows.filter((r) => {
    const pos = String(r.position ?? '').trim().toUpperCase()
    return pos !== 'DEF' && pos !== 'K' && pos !== 'PK'
  })
  const rookieSignalAvailable = rookieRelevant.filter(
    (r) => r.isRookie === true || r.yearsExp != null,
  ).length
  const rookieSignalPct =
    rookieRelevant.length > 0 ? (rookieSignalAvailable / rookieRelevant.length) * 100 : 100

  if (rookieSignalPct < 95) {
    failures.push({
      check: 'rookie_signal_coverage_below_95pct',
      severity: 'warning',
      classification: 'needs_cache_rebuild',
      detail: `${rookieSignalPct.toFixed(2)}% coverage`,
    })
  }

  // identityMissingSleeperCarryForward — derive live from cache + identity rows
  const cacheSleeperByKey = new Map<string, string>()
  for (const row of rows) {
    if (!row.sleeperId) continue
    const key = `${canonicalName(row.name)}|${canonicalPosition(row.position)}|${canonicalTeam(row.team)}`
    if (!cacheSleeperByKey.has(key)) cacheSleeperByKey.set(key, row.sleeperId)
  }

  const identityMissingRows = await prisma.playerIdentityMap.findMany({
    where: { sport: 'NFL', sleeperId: null },
    select: { canonicalName: true, position: true, currentTeam: true },
    take: 10000,
  })

  const identityMissingSleeperCarryForward = identityMissingRows.filter((r) => {
    const key = `${canonicalName(r.canonicalName)}|${canonicalPosition(r.position)}|${canonicalTeam(r.currentTeam)}`
    return cacheSleeperByKey.has(key)
  }).length

  if (identityMissingSleeperCarryForward > 0) {
    failures.push({
      check: 'identity_missing_sleeper_carry_forward',
      severity: 'warning',
      classification: 'backfill_resolvable',
      detail: `${identityMissingSleeperCarryForward} rows — run: npm run draft-pool:backfill-blocked-sleeper-ids -- --leagueId=<id> --apply`,
    })
  }

  const metrics: LeagueMetrics = {
    entryCount: cacheEntryCount,
    duplicatePlayerIdGroups: dupPlayerIdGroups.length,
    knownPairCollisionViolations: pairCollisionViolations,
    missingHeadshots,
    trueMissingTeamLogos,
    missingProjectionCount,
    fallbackProjectionCount: fallbackRows.length,
    fallbackBySource,
    taggedRealRows,
    rookieSignalCoveragePct: Number(rookieSignalPct.toFixed(2)),
    identityMissingSleeperCarryForward,
    duplicateSleeperIdGroups: dupSleeperIdGroups.length,
  }

  return { metrics, pass: failures.length === 0, failures }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  // 1. All leagues
  const allLeagues = await prisma.league.findMany({
    select: { id: true, name: true, sport: true },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  // 2. Latest cache per league
  const allCacheRows = await prisma.draftPoolCache.findMany({
    where: { cacheKey: { contains: 'draft_pool:' } },
    select: { leagueId: true, cacheKey: true, sport: true, syncedAt: true, entryCount: true, payload: true },
    orderBy: { syncedAt: 'desc' },
    take: 500,
  })

  const latestCacheByLeague = new Map<string, (typeof allCacheRows)[number]>()
  for (const row of allCacheRows) {
    if (!latestCacheByLeague.has(row.leagueId)) latestCacheByLeague.set(row.leagueId, row)
  }

  // Only judge pools someone is likely to see again. Every check below is NFL-specific (the
  // Russell Wilson / Achane / Marvin Harrison pins, the projection fields), so an NBA or NCAAF
  // pool failed all of them by construction. And the cache TTL is minutes — a pool synced months
  // ago is rebuilt on its next read, so its old contents say nothing about what a draft room
  // would show today. Both kinds are counted and reported as skipped, never silently dropped.
  const cutoff = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000)
  const skipped = { notNfl: 0, olderThanWindow: 0 }
  const cachedLeagueIds = [...latestCacheByLeague.keys()].filter((leagueId) => {
    const cache = latestCacheByLeague.get(leagueId)!
    if (String(cache.sport ?? '').toUpperCase() !== 'NFL') {
      skipped.notNfl++
      return false
    }
    if (cache.syncedAt < cutoff) {
      skipped.olderThanWindow++
      return false
    }
    return true
  })
  const uncachedLeagues = allLeagues.filter((l) => !latestCacheByLeague.has(l.id))

  type LeagueResult = {
    leagueId: string
    leagueName: string
    sport: string
    cacheKey: string
    cacheSyncedAt: string
    entryCount: number
    pass: boolean
    metrics: LeagueMetrics
    failures: FailureDetail[]
  }

  const results: LeagueResult[] = []

  for (const leagueId of cachedLeagueIds) {
    const cache = latestCacheByLeague.get(leagueId)!
    const league = allLeagues.find((l) => l.id === leagueId)

    const { metrics, pass, failures } = await evaluateLeague(leagueId, cache.payload, cache.entryCount)

    results.push({
      leagueId,
      leagueName: league?.name ?? '(unknown)',
      sport: league?.sport ?? '(unknown)',
      cacheKey: cache.cacheKey,
      cacheSyncedAt: cache.syncedAt.toISOString(),
      entryCount: cache.entryCount,
      pass,
      metrics,
      failures,
    })
  }

  const passCount = results.filter((r) => r.pass).length
  const failCount = results.filter((r) => !r.pass).length

  const report = {
    sweepDate: new Date().toISOString(),
    prismaValidate: 'PASS',
    totalLeagues: allLeagues.length,
    totalCachedLeagues: latestCacheByLeague.size,
    sweptLeagues: cachedLeagueIds.length,
    windowDays: args.days,
    skipped,
    totalUncachedLeagues: uncachedLeagues.length,
    passCount,
    failCount,
    results,
    uncachedLeagues: uncachedLeagues.map((l) => ({
      leagueId: l.id,
      leagueName: l.name,
      sport: l.sport,
      status: 'needs_cache_warm',
      recommendation: `npm run draft-pool:cache:warm -- --leagueId=${l.id}`,
    })),
    recommendedFixOrder: buildFixOrder(results),
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printReport(report, args.verbose)
  }

  if (failCount > 0) process.exitCode = 1
}

function buildFixOrder(results: Array<{ leagueId: string; failures: FailureDetail[] }>): string[] {
  const order: string[] = []
  const hasClass = (cls: FailureDetail['classification']) =>
    results.some((r) => r.failures.some((f) => f.classification === cls))

  if (hasClass('backfill_resolvable'))
    order.push('1. Run draft-pool:backfill-blocked-sleeper-ids --apply for affected leagues')
  if (hasClass('needs_cache_rebuild'))
    order.push('2. Re-warm DraftPoolCache for affected leagues (draft-pool:cache:warm)')
  if (hasClass('needs_code_fix'))
    order.push('3. Code-level fix required — see failure details above')
  if (hasClass('needs_manual_review'))
    order.push('4. Manual identity review required — see failure details')
  if (order.length === 0)
    order.push('All cached leagues pass — warm uncached leagues and re-sweep to extend coverage')
  return order
}

function printReport(report: ReturnType<typeof buildFixOrder> extends string[] ? never : Awaited<ReturnType<typeof main>> extends void ? never : any, verbose: boolean): void {
  const r = report as any

  console.log('\n╔══════════════════════════════════════════════════════════════')
  console.log('║  MULTI-LEAGUE DRAFT POOL DATA-QUALITY SWEEP')
  console.log(`║  ${r.sweepDate}`)
  console.log('╚══════════════════════════════════════════════════════════════\n')

  console.log(`  Total leagues in DB : ${r.totalLeagues}`)
  console.log(`  Leagues with cache  : ${r.totalCachedLeagues}`)
  console.log(`  Swept (NFL, synced in last ${r.windowDays} days): ${r.sweptLeagues}`)
  console.log(`  Skipped             : ${r.skipped.notNfl} not NFL, ${r.skipped.olderThanWindow} synced before the window`)
  console.log(`  Leagues without cache: ${r.totalUncachedLeagues}`)
  console.log(`  Prisma validate     : ${r.prismaValidate}`)
  console.log()
  console.log(`  SWEEP RESULT: ${r.passCount} PASS / ${r.failCount} FAIL\n`)

  for (const league of r.results) {
    const badge = league.pass ? '✓ PASS' : '✗ FAIL'
    console.log(`  [${badge}] ${league.leagueName}`)
    console.log(`         leagueId  : ${league.leagueId}`)
    console.log(`         entries   : ${league.entryCount}`)
    console.log(`         syncedAt  : ${league.cacheSyncedAt}`)
    const m = league.metrics
    console.log(`         metrics   : dupPlayerIds=${m.duplicatePlayerIdGroups}  dupSleeperIds=${m.duplicateSleeperIdGroups}  pairCollisions=${m.knownPairCollisionViolations}  missingHeadshots=${m.missingHeadshots}  missingTeamLogos=${m.trueMissingTeamLogos}  missingProjections=${m.missingProjectionCount}  identityMissingSleeperForward=${m.identityMissingSleeperCarryForward}  rookieSignalPct=${m.rookieSignalCoveragePct}`)

    if (!league.pass || verbose) {
      for (const f of league.failures) {
        const icon = f.severity === 'error' ? '  ✗' : '  ⚠'
        console.log(`${icon} [${f.classification}] ${f.check}${f.detail ? ': ' + f.detail : ''}`)
      }
    }
    console.log()
  }

  if (r.uncachedLeagues.length > 0) {
    console.log(`  Leagues without cache (not yet swept): ${r.uncachedLeagues.length}${verbose ? '' : ' — first 10 (--verbose for all)'}`)
    for (const u of verbose ? r.uncachedLeagues : r.uncachedLeagues.slice(0, 10)) {
      console.log(`    - ${u.leagueName} (${u.leagueId})`)
      console.log(`      → ${u.recommendation}`)
    }
    console.log()
  }

  if (r.recommendedFixOrder.length > 0) {
    console.log('  Recommended next steps:')
    for (const step of r.recommendedFixOrder) {
      console.log(`    ${step}`)
    }
    console.log()
  }
}

void main()
  .catch((err) => {
    console.error('[sweep-draft-pool-multi-league] failed:', err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
