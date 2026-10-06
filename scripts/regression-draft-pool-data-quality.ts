/**
 * Regression assertions for draft pool data-quality fixes.
 *
 * Usage:
 *   npx tsx scripts/regression-draft-pool-data-quality.ts --leagueId=<leagueId>
 */

import { PrismaClient } from '@prisma/client'
import { canonicalName, canonicalPosition, canonicalTeam } from '../lib/draft-room/player-canonical-identity'

const prisma = new PrismaClient()

type AnyObj = Record<string, unknown>

type Row = {
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

function parseArgs(argv: string[]): { leagueId: string } {
  let leagueId = ''
  for (const part of argv) {
    if (part.startsWith('--leagueId=')) leagueId = part.slice('--leagueId='.length)
    else if (part.startsWith('--league=')) leagueId = part.slice('--league='.length)
  }
  return { leagueId }
}

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
  for (const segment of path) {
    if (!cur || typeof cur !== 'object') return null
    cur = (cur as AnyObj)[segment]
  }
  return cur
}

function isFreeAgentTeam(team: string | null): boolean {
  const t = String(team ?? '').trim().toUpperCase()
  return !t || t === 'FA' || t === 'F/A' || t === 'N/A' || t === 'NONE'
}

function toRows(payload: unknown): Row[] {
  if (!payload || typeof payload !== 'object') return []
  const entries = Array.isArray((payload as AnyObj).entries) ? ((payload as AnyObj).entries as unknown[]) : []

  return entries
    .filter((entry): entry is AnyObj => Boolean(entry && typeof entry === 'object'))
    .map((entry) => {
      const stats = readPath(entry, ['display', 'stats']) as AnyObj | null
      const assets = readPath(entry, ['display', 'assets']) as AnyObj | null
      const supplemental = stats ? (stats.rollingInsightsSupplemental as AnyObj | null) : null

      const playerId = str(entry.playerId) ?? str(readPath(entry, ['display', 'playerId']))
      const sleeperIdRaw = str((entry as AnyObj).sleeperId)
      const sleeperId = sleeperIdRaw ?? (/^\d{3,}$/.test(String(playerId ?? '').trim()) ? playerId : null)

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

function assertCheck(condition: boolean, label: string, failures: string[]): void {
  if (!condition) failures.push(label)
}

function matching(rows: Row[], name: string): Row[] {
  const target = canonicalName(name)
  return rows.filter((row) => canonicalName(row.name) === target)
}

function uniqueNonNull(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === 'string' && v.trim().length > 0))]
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!args.leagueId) {
    throw new Error('Missing --leagueId=<leagueId>')
  }

  const cache = await prisma.draftPoolCache.findFirst({
    where: {
      leagueId: args.leagueId,
      cacheKey: { contains: 'draft_pool:' },
    },
    orderBy: { syncedAt: 'desc' },
    select: {
      id: true,
      cacheKey: true,
      syncedAt: true,
      payload: true,
      entryCount: true,
    },
  })

  if (!cache) throw new Error(`No draft pool cache row for leagueId=${args.leagueId}`)

  const rows = toRows(cache.payload)
  const failures: string[] = []

  const byPlayerId = new Map<string, Row[]>()
  for (const row of rows) {
    if (!row.playerId) continue
    const list = byPlayerId.get(row.playerId) ?? []
    list.push(row)
    byPlayerId.set(row.playerId, list)
  }

  const duplicatePlayerIdGroups = [...byPlayerId.entries()]
    .filter(([, grouped]) => grouped.length > 1)
    .map(([playerId, grouped]) => ({ playerId, grouped }))

  // 1) known collision pairs should not share a duplicate playerId
  const collisionPairs: Array<[string, string]> = [
    ['Kenneth Walker III', 'Gabe Davis'],
    ["Dont'e Thornton Jr.", 'Irvin Charles'],
    ['Brevin Jordan', 'Mitchell Tinsley'],
    ['Adam Trautman', 'Velus Jones Jr.'],
    ['Austin Hooper', 'Josh Gable'],
  ]

  let pairCollisionViolations = 0
  for (const [leftName, rightName] of collisionPairs) {
    const leftRows = matching(rows, leftName)
    const rightRows = matching(rows, rightName)
    const leftIds = new Set(uniqueNonNull(leftRows.map((row) => row.playerId)))
    const rightIds = new Set(uniqueNonNull(rightRows.map((row) => row.playerId)))
    const hasSharedId = [...leftIds].some((id) => rightIds.has(id))
    if (hasSharedId) pairCollisionViolations += 1
  }
  assertCheck(pairCollisionViolations === 0, 'Known collision pairs do not share duplicate playerId', failures)

  // Also keep broad duplicate groups guardrail.
  assertCheck(duplicatePlayerIdGroups.length === 0, 'Global duplicate playerId groups remain zero', failures)

  // 2) Marvin Jr and non-Jr distinct.
  const marvinJr = matching(rows, 'Marvin Harrison Jr.')
  const marvin = matching(rows, 'Marvin Harrison')
  assertCheck(marvinJr.length > 0 && marvin.length > 0, 'Both Marvin Harrison Jr. and Marvin Harrison rows exist', failures)
  const marvinJrIds = new Set(uniqueNonNull(marvinJr.map((row) => row.playerId)))
  const marvinIds = new Set(uniqueNonNull(marvin.map((row) => row.playerId)))
  const marvinShared = [...marvinJrIds].some((id) => marvinIds.has(id))
  assertCheck(!marvinShared, 'Marvin Harrison Jr. and Marvin Harrison stay distinct identities', failures)

  // 3) Russell Wilson one row with sleeperId 1234.
  const russell = matching(rows, 'Russell Wilson')
  assertCheck(russell.length === 1, 'Russell Wilson remains one row', failures)
  assertCheck((russell[0]?.sleeperId ?? null) === '1234', 'Russell Wilson sleeperId is 1234', failures)

  // 4) De'Von Achane one row with sleeperId 9226 (7373 is Gus Cumberlander, not Achane).
  const achane = matching(rows, "De'Von Achane")
  assertCheck(achane.length === 1, "De'Von Achane remains one row", failures)
  assertCheck((achane[0]?.sleeperId ?? null) === '9226', "De'Von Achane sleeperId is 9226", failures)

  // 5) missingHeadshots stays 0.
  const missingHeadshots = rows.filter((row) => !row.headshotUrl).length
  assertCheck(missingHeadshots === 0, 'missingHeadshots is 0', failures)

  // 6) true missing team logos stays 0.
  const trueMissingTeamLogos = rows.filter((row) => !isFreeAgentTeam(row.team) && !row.teamLogoUrl).length
  assertCheck(trueMissingTeamLogos === 0, 'true missing team logos is 0', failures)

  // 7) fallback fills missing projections without overwriting real projections.
  const missingProjectionCount = rows.filter((row) => row.fantasyPointsPerGame == null).length
  const fallbackRows = rows.filter((row) => row.projectionSource != null)
  const fallbackSources = fallbackRows.reduce((acc, row) => {
    const key = row.projectionSource as string
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)
  assertCheck(missingProjectionCount === 0, 'Projection fallback fills all missing projections', failures)
  assertCheck(fallbackRows.length > 0, 'Fallback projections exist', failures)

  // 8) projectionSource present for fallback rows.
  const fallbackMissingSource = fallbackRows.filter((row) => !row.projectionSource).length
  assertCheck(fallbackMissingSource === 0, 'Fallback rows have projectionSource tags', failures)

  // 9) real projection rows do not get fallback source tags.
  const taggedRealRows = rows.filter(
    (row) => row.projectionSource != null && row.rollingInsightsSupplementalFppg != null,
  )
  assertCheck(taggedRealRows.length === 0, 'Real projection rows are not fallback-tagged', failures)

  // 10) rookie flags remain available enough for rookie toggle behavior.
  // 11) identity map has no blocked sleeper carry-forward rows (all resolved).
  const cacheSleeperByStrictKey = new Map<string, string>()
  for (const row of rows) {
    if (!row.sleeperId) continue
    const key = `${canonicalName(row.name)}|${canonicalPosition(row.position)}|${canonicalTeam(row.team)}`
    if (!cacheSleeperByStrictKey.has(key)) cacheSleeperByStrictKey.set(key, row.sleeperId)
  }

  const identityMissingRows = await prisma.playerIdentityMap.findMany({
    where: { sport: 'NFL', sleeperId: null },
    select: { canonicalName: true, position: true, currentTeam: true },
    take: 10000,
  })

  const identityMissingSleeperCarryForward = identityMissingRows.filter((r) => {
    const key = `${canonicalName(r.canonicalName)}|${canonicalPosition(r.position)}|${canonicalTeam(r.currentTeam)}`
    return cacheSleeperByStrictKey.has(key)
  }).length

  assertCheck(
    identityMissingSleeperCarryForward === 0,
    `Identity rows with resolvable sleeperId stay at zero (found ${identityMissingSleeperCarryForward})`,
    failures,
  )

  const rookieRelevant = rows.filter((row) => {
    const pos = String(row.position ?? '').trim().toUpperCase()
    return pos !== 'DEF' && pos !== 'K' && pos !== 'PK'
  })
  const rookieSignalAvailable = rookieRelevant.filter(
    (row) => row.isRookie === true || row.yearsExp != null,
  ).length
  const rookieSignalPct = rookieRelevant.length > 0 ? (rookieSignalAvailable / rookieRelevant.length) * 100 : 100
  assertCheck(rookieSignalPct >= 95, 'Rookie signal coverage is at least 95% for non-DEF/K rows', failures)

  const summary = {
    leagueId: args.leagueId,
    cache: {
      id: cache.id,
      cacheKey: cache.cacheKey,
      syncedAt: cache.syncedAt.toISOString(),
      entryCount: cache.entryCount,
      payloadEntries: rows.length,
    },
    metrics: {
      duplicatePlayerIdGroups: duplicatePlayerIdGroups.length,
      knownPairCollisionViolations: pairCollisionViolations,
      missingHeadshots,
      trueMissingTeamLogos,
      missingProjectionCount,
      fallbackProjectionCount: fallbackRows.length,
      fallbackBySource: fallbackSources,
      taggedRealRows: taggedRealRows.length,
      rookieSignalCoveragePct: Number(rookieSignalPct.toFixed(2)),
      identityMissingSleeperCarryForward,
    },
    checks: {
      pass: failures.length === 0,
      failures,
    },
  }

  console.log(JSON.stringify(summary, null, 2))

  if (failures.length > 0) {
    process.exitCode = 1
  }
}

void main()
  .catch((error) => {
    console.error('[regression-draft-pool-data-quality] failed:', error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
