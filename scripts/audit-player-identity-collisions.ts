/**
 * Draft pool identity collision audit (READ-ONLY).
 *
 * Usage:
 *   npx tsx scripts/audit-player-identity-collisions.ts --leagueId=<id> [--json]
 *
 * Optional:
 *   --limitGroups=25   Max groups to print per section (default 25, max 100)
 */

import { PrismaClient } from '@prisma/client'
import { canonicalName, canonicalPosition, canonicalTeam } from '../lib/draft-room/player-canonical-identity'
import { loadNflRookieLookup, lookupYearsExp } from '../lib/draft-room/nflRookieLookup'

const prisma = new PrismaClient()

type Args = {
  leagueId: string
  json: boolean
  limitGroups: number
}

type AnyObj = Record<string, unknown>

type CacheEntry = {
  name: string
  position: string
  team: string | null
  playerId: string | null
  sleeperId: string | null
  headshotUrl: string | null
  teamLogoUrl: string | null
  yearsExp: number | null
  isRookie: boolean | null
  rookieYear: number | null
}

type RookieGapClassification =
  | 'veteran_missing_experience'
  | 'true_rookie_missing_flag'
  | 'free_agent_no_team_unknown'
  | 'defense_or_special_case'
  | 'missing_identity_map_enrichment'
  | 'unknown_missing_rookie_signal'

type GroupRow = {
  name: string
  position: string
  team: string | null
  playerId: string | null
  sleeperId: string | null
  headshotUrl: string | null
  normalizedName: string
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    leagueId: '',
    json: false,
    limitGroups: 25,
  }

  for (const raw of argv) {
    if (raw.startsWith('--league=')) out.leagueId = raw.slice('--league='.length)
    else if (raw.startsWith('--leagueId=')) out.leagueId = raw.slice('--leagueId='.length)
    else if (raw === '--json') out.json = true
    else if (raw.startsWith('--limitGroups=')) {
      const n = Number.parseInt(raw.slice('--limitGroups='.length), 10)
      if (Number.isFinite(n) && n > 0) out.limitGroups = Math.min(100, n)
    }
  }

  return out
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

function intOrNull(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return Math.trunc(v)
}

function readPath(obj: AnyObj, path: string[]): unknown {
  let cur: unknown = obj
  for (const part of path) {
    if (!cur || typeof cur !== 'object') return null
    cur = (cur as AnyObj)[part]
  }
  return cur
}

function looksLikeSleeperId(value: string | null | undefined): boolean {
  const t = String(value ?? '').trim()
  return /^\d{3,}$/.test(t)
}

function toEntries(payload: unknown): AnyObj[] {
  if (!payload || typeof payload !== 'object') return []
  const root = payload as { entries?: unknown }
  const entries = Array.isArray(root.entries) ? root.entries : []
  return entries.filter((v): v is AnyObj => Boolean(v && typeof v === 'object'))
}

function extractEntry(entry: AnyObj): CacheEntry {
  const name = str(entry.name) ?? str(readPath(entry, ['display', 'displayName'])) ?? 'unknown'
  const position =
    str(entry.position) ??
    str(readPath(entry, ['display', 'metadata', 'position'])) ??
    ''
  const team =
    str(entry.team) ??
    str(readPath(entry, ['display', 'team', 'abbreviation'])) ??
    str(readPath(entry, ['display', 'team', 'displayName']))

  const topPlayerId = str(entry.playerId)
  const displayPlayerId = str(readPath(entry, ['display', 'playerId']))
  const playerId = topPlayerId ?? displayPlayerId

  const topSleeperId = str(entry.sleeperId)
  const sleeperId = topSleeperId ?? (looksLikeSleeperId(playerId) ? playerId : null)

  const headshotUrl =
    str(readPath(entry, ['display', 'assets', 'headshotUrl'])) ??
    str(entry.headshotUrl)

  const teamLogoUrl =
    str(readPath(entry, ['display', 'assets', 'teamLogoUrl'])) ??
    str(readPath(entry, ['display', 'team', 'logoUrl'])) ??
    str(entry.teamLogoUrl)

  return {
    name,
    position,
    team: team ?? null,
    playerId: playerId ?? null,
    sleeperId,
    headshotUrl: headshotUrl ?? null,
    teamLogoUrl: teamLogoUrl ?? null,
    yearsExp: num(entry.yearsExp),
    isRookie: boolOrNull(entry.isRookie),
    rookieYear: intOrNull(entry.rookieYear),
  }
}

function groupDuplicates(rows: GroupRow[], keyOf: (r: GroupRow) => string | null): Array<{ key: string; rows: GroupRow[] }> {
  const map = new Map<string, GroupRow[]>()
  for (const r of rows) {
    const key = keyOf(r)
    if (!key) continue
    const existing = map.get(key) ?? []
    existing.push(r)
    map.set(key, existing)
  }
  return [...map.entries()]
    .filter(([, grouped]) => grouped.length > 1)
    .map(([key, grouped]) => ({ key, rows: grouped }))
    .sort((a, b) => b.rows.length - a.rows.length || a.key.localeCompare(b.key))
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  return value as Record<string, unknown>
}

function readNumberField(obj: Record<string, unknown> | null, keys: string[]): number | null {
  if (!obj) return null
  for (const key of keys) {
    const raw = obj[key]
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw
    if (typeof raw === 'string') {
      const n = Number(raw)
      if (Number.isFinite(n)) return n
    }
  }
  return null
}

function deriveRookieYearFromYearsExp(yearsExp: number | null, referenceSeason: number): number | null {
  if (yearsExp == null || !Number.isFinite(yearsExp) || yearsExp < 0) return null
  return referenceSeason - Math.trunc(yearsExp)
}

function classifyRookieGapRow(input: {
  position: string
  team: string | null
  identityMatched: boolean
  sleeperYearsExp: number | null
  sportsRecordYearsExp: number | null
  veteranGamesEvidence: boolean
}): RookieGapClassification {
  const pos = canonicalPosition(input.position)
  if (pos === 'DEF' || pos === 'K') return 'defense_or_special_case'

  if (!input.identityMatched) return 'missing_identity_map_enrichment'

  const bestYearsExp =
    input.sleeperYearsExp != null ? input.sleeperYearsExp : input.sportsRecordYearsExp

  if (bestYearsExp != null) {
    if (bestYearsExp === 0) return 'true_rookie_missing_flag'
    if (bestYearsExp > 0) return 'veteran_missing_experience'
  }

  if (input.veteranGamesEvidence) return 'veteran_missing_experience'

  if (!input.team || canonicalTeam(input.team) === 'FA') return 'free_agent_no_team_unknown'

  return 'unknown_missing_rookie_signal'
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!args.leagueId) throw new Error('Missing --leagueId=<leagueId>')

  const latestCache = await prisma.draftPoolCache.findFirst({
    where: {
      leagueId: args.leagueId,
      cacheKey: { contains: 'draft_pool:' },
    },
    select: {
      id: true,
      cacheKey: true,
      syncedAt: true,
      entryCount: true,
      payload: true,
    },
    orderBy: { syncedAt: 'desc' },
  })

  if (!latestCache) {
    throw new Error(`No draft_pool cache row found for leagueId=${args.leagueId}`)
  }

  const rawEntries = toEntries(latestCache.payload)
  const entries = rawEntries.map(extractEntry)

  const rows: GroupRow[] = entries.map((e) => ({
    name: e.name,
    position: e.position,
    team: e.team,
    playerId: e.playerId,
    sleeperId: e.sleeperId,
    headshotUrl: e.headshotUrl,
    normalizedName: canonicalName(e.name),
  }))

  const duplicatePlayerIdGroups = groupDuplicates(rows, (r) => r.playerId)
  const duplicateSleeperIdGroups = groupDuplicates(rows, (r) => r.sleeperId)

  const headshotGroups = groupDuplicates(rows, (r) => r.headshotUrl)
    .filter((g) => unique(g.rows.map((r) => r.normalizedName)).length > 1)

  const jrPairsMap = new Map<string, { jrRows: GroupRow[]; baseRows: GroupRow[] }>()
  for (const r of rows) {
    const pos = canonicalPosition(r.position)
    const team = canonicalTeam(r.team)
    const n = r.normalizedName
    if (!n) continue

    if (/(^|\s)jr$/.test(n)) {
      const base = n.replace(/(^|\s)jr$/, '').trim()
      const key = `${base}|${pos}|${team}`
      const existing = jrPairsMap.get(key) ?? { jrRows: [], baseRows: [] }
      existing.jrRows.push(r)
      jrPairsMap.set(key, existing)
    } else {
      const key = `${n}|${pos}|${team}`
      const existing = jrPairsMap.get(key) ?? { jrRows: [], baseRows: [] }
      existing.baseRows.push(r)
      jrPairsMap.set(key, existing)
    }
  }

  const jrAliasPairs = [...jrPairsMap.entries()]
    .filter(([, v]) => v.jrRows.length > 0 && v.baseRows.length > 0)
    .map(([key, v]) => ({
      key,
      jrRows: v.jrRows,
      baseRows: v.baseRows,
    }))
    .sort((a, b) => (b.jrRows.length + b.baseRows.length) - (a.jrRows.length + a.baseRows.length))

  const sleeperByStrictIdentity = new Map<string, string>()
  for (const e of entries) {
    if (!e.sleeperId) continue
    const key = `${canonicalName(e.name)}|${canonicalPosition(e.position)}|${canonicalTeam(e.team)}`
    if (!sleeperByStrictIdentity.has(key)) sleeperByStrictIdentity.set(key, e.sleeperId)
  }

  const identityRows = await prisma.playerIdentityMap.findMany({
    where: { sport: 'NFL' },
    select: {
      id: true,
      canonicalName: true,
      position: true,
      currentTeam: true,
      sleeperId: true,
      rollingInsightsId: true,
      updatedAt: true,
    },
    take: 5000,
  })

  const identityMissingSleeperCarryForward = identityRows
    .map((row) => {
      const key = `${canonicalName(row.canonicalName)}|${canonicalPosition(row.position)}|${canonicalTeam(row.currentTeam)}`
      const expectedSleeperId = sleeperByStrictIdentity.get(key) ?? null
      if (!expectedSleeperId || row.sleeperId) return null
      return {
        identityId: row.id,
        canonicalName: row.canonicalName,
        position: row.position,
        currentTeam: row.currentTeam,
        identitySleeperId: row.sleeperId,
        expectedSleeperId,
        rollingInsightsId: row.rollingInsightsId,
        updatedAt: row.updatedAt,
      }
    })
    .filter((v): v is NonNullable<typeof v> => Boolean(v))

  const rookieBundle = await loadNflRookieLookup().catch(() => null)
  const rookieLookup = rookieBundle?.lookup ?? null
  const referenceSeason = latestCache.syncedAt.getUTCFullYear()

  const identityByStrictKey = new Map<string, (typeof identityRows)[number]>()
  for (const row of identityRows) {
    const key = `${canonicalName(row.canonicalName)}|${canonicalPosition(row.position)}|${canonicalTeam(row.currentTeam)}`
    if (key && !identityByStrictKey.has(key)) identityByStrictKey.set(key, row)
  }

  const rookieGapBaseRows = entries
    .filter((e) => {
      const pos = canonicalPosition(e.position)
      if (pos === 'DEF' || pos === 'K') return false
      return e.isRookie !== true && e.yearsExp == null
    })
    .map((e) => {
      const strictKey = `${canonicalName(e.name)}|${canonicalPosition(e.position)}|${canonicalTeam(e.team)}`
      return {
        ...e,
        strictKey,
        normalizedName: canonicalName(e.name),
      }
    })

  const rookieNames = unique(rookieGapBaseRows.map((r) => r.name).filter(Boolean))
  const rookiePlayerIds = unique(
    rookieGapBaseRows.flatMap((r) => [r.playerId, r.sleeperId]).filter((v): v is string => Boolean(v && String(v).trim())),
  )

  const sportsPlayers = rookieNames.length
    ? await prisma.sportsPlayer.findMany({
        where: { sport: 'NFL', name: { in: rookieNames } },
        select: {
          name: true,
          position: true,
          team: true,
          sleeperId: true,
          source: true,
          age: true,
        },
        take: 10000,
      })
    : []

  const sportsPlayersByStrictKey = new Map<string, (typeof sportsPlayers)[number]>()
  for (const row of sportsPlayers) {
    const key = `${canonicalName(row.name)}|${canonicalPosition(row.position)}|${canonicalTeam(row.team)}`
    if (key && !sportsPlayersByStrictKey.has(key)) sportsPlayersByStrictKey.set(key, row)
  }

  const sportsPlayerRecords = rookieNames.length
    ? await prisma.sportsPlayerRecord.findMany({
        where: { sport: 'NFL', name: { in: rookieNames } },
        select: {
          id: true,
          name: true,
          position: true,
          team: true,
          stats: true,
          projections: true,
          dataSource: true,
          lastUpdated: true,
        },
        take: 10000,
      })
    : []

  const sportsRecordById = new Map<string, (typeof sportsPlayerRecords)[number]>()
  const sportsRecordByStrictKey = new Map<string, (typeof sportsPlayerRecords)[number]>()
  for (const row of sportsPlayerRecords) {
    const id = String(row.id ?? '').trim()
    if (id && !sportsRecordById.has(id)) sportsRecordById.set(id, row)
    const key = `${canonicalName(row.name)}|${canonicalPosition(row.position)}|${canonicalTeam(row.team)}`
    if (key && !sportsRecordByStrictKey.has(key)) sportsRecordByStrictKey.set(key, row)
  }

  const rookieSignalGapDetails = rookieGapBaseRows.map((e) => {
    const strictKey = e.strictKey
    const identityHit = identityByStrictKey.get(strictKey) ?? null
    const sportsPlayerHit =
      sportsPlayersByStrictKey.get(strictKey) ??
      (e.sleeperId ? sportsPlayers.find((row) => String(row.sleeperId ?? '').trim() === e.sleeperId) ?? null : null)

    const sportsRecordHit =
      (e.playerId ? sportsRecordById.get(String(e.playerId)) ?? null : null) ??
      (e.sleeperId ? sportsRecordById.get(String(e.sleeperId)) ?? null : null) ??
      sportsRecordByStrictKey.get(strictKey) ??
      null

    const statsObj = parseJsonObject(sportsRecordHit?.stats ?? null)
    const projectionsObj = parseJsonObject(sportsRecordHit?.projections ?? null)
    const sportsRecordYearsExp =
      readNumberField(statsObj, ['years_exp', 'yearsExp', 'experience']) ??
      readNumberField(projectionsObj, ['years_exp', 'yearsExp', 'experience'])
    const sportsRecordGamesPlayed =
      readNumberField(statsObj, ['games_played', 'gamesPlayed', 'gp']) ??
      readNumberField(projectionsObj, ['games_played', 'gamesPlayed', 'gp'])

    const sleeperYearsExp = rookieLookup
      ? lookupYearsExp(rookieLookup, e.name, e.position, e.sleeperId ?? e.playerId)
      : null

    const inferredYearsExp =
      e.yearsExp ??
      (sleeperYearsExp != null ? sleeperYearsExp : sportsRecordYearsExp != null ? sportsRecordYearsExp : null)

    const rookieYear =
      e.rookieYear ??
      deriveRookieYearFromYearsExp(
        inferredYearsExp,
        referenceSeason,
      )

    const veteranGamesEvidence =
      typeof sportsRecordGamesPlayed === 'number' && Number.isFinite(sportsRecordGamesPlayed) && sportsRecordGamesPlayed > 0

    const classification = classifyRookieGapRow({
      position: e.position,
      team: e.team,
      identityMatched: Boolean(identityHit),
      sleeperYearsExp,
      sportsRecordYearsExp,
      veteranGamesEvidence,
    })

    return {
      playerId: e.playerId,
      sleeperId: e.sleeperId,
      name: e.name,
      team: e.team,
      position: e.position,
      yearsExp: e.yearsExp,
      isRookie: e.isRookie,
      rookieYear,
      classification,
      sourceTables: {
        sleeperLookup: {
          matched: sleeperYearsExp != null,
          yearsExp: sleeperYearsExp,
          rookieYear: deriveRookieYearFromYearsExp(sleeperYearsExp, referenceSeason),
        },
        playerIdentityMap: {
          matched: Boolean(identityHit),
          sleeperId: identityHit?.sleeperId ?? null,
          rollingInsightsId: identityHit?.rollingInsightsId ?? null,
        },
        sportsPlayer: {
          matched: Boolean(sportsPlayerHit),
          source: sportsPlayerHit?.source ?? null,
          sleeperId: sportsPlayerHit?.sleeperId ?? null,
          age: sportsPlayerHit?.age ?? null,
        },
        sportsPlayerRecord: {
          matched: Boolean(sportsRecordHit),
          id: sportsRecordHit?.id ?? null,
          dataSource: sportsRecordHit?.dataSource ?? null,
          yearsExp: sportsRecordYearsExp,
          gamesPlayed: sportsRecordGamesPlayed,
          lastUpdated: sportsRecordHit?.lastUpdated ?? null,
        },
      },
    }
  })

  const rookieGapByClassification = rookieSignalGapDetails.reduce(
    (acc, row) => {
      acc[row.classification] = (acc[row.classification] ?? 0) + 1
      return acc
    },
    {} as Record<RookieGapClassification, number>,
  )

  const report = {
    leagueId: args.leagueId,
    latestCache: {
      id: latestCache.id,
      cacheKey: latestCache.cacheKey,
      syncedAt: latestCache.syncedAt,
      entryCount: latestCache.entryCount,
      payloadEntries: entries.length,
    },
    counts: {
      duplicatePlayerIdGroups: duplicatePlayerIdGroups.length,
      duplicateSleeperIdGroups: duplicateSleeperIdGroups.length,
      sameHeadshotDifferentNormalizedNames: headshotGroups.length,
      jrNonJrAliasPairs: jrAliasPairs.length,
      identityMissingSleeperCarryForward: identityMissingSleeperCarryForward.length,
      rookieSignalGapsNonDefK: rookieSignalGapDetails.length,
    },
    rookieSignalGapClassification: rookieGapByClassification,
    duplicatePlayerIdGroups: duplicatePlayerIdGroups.slice(0, args.limitGroups),
    duplicateSleeperIdGroups: duplicateSleeperIdGroups.slice(0, args.limitGroups),
    sameHeadshotDifferentNormalizedNames: headshotGroups.slice(0, args.limitGroups).map((g) => ({
      headshotUrl: g.key,
      normalizedNames: unique(g.rows.map((r) => r.normalizedName)),
      rows: g.rows,
    })),
    jrNonJrAliasPairs: jrAliasPairs.slice(0, args.limitGroups),
    identityMissingSleeperCarryForward: identityMissingSleeperCarryForward.slice(0, args.limitGroups),
    rookieSignalGapsSample: rookieSignalGapDetails.slice(0, args.limitGroups),
    assertions: {
      duplicatePlayerIdGroupsShouldBeZero: duplicatePlayerIdGroups.length === 0,
      marvinJrAliasPairPresent: jrAliasPairs.some((p) => p.key.startsWith('marvin harrison|WR|ARI')),
    },
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log('')
    console.log('============================================================')
    console.log(' Draft Pool Identity Collision Audit')
    console.log('============================================================')
    console.log(`leagueId: ${report.leagueId}`)
    console.log(`cacheKey: ${report.latestCache.cacheKey}`)
    console.log(`syncedAt: ${String(report.latestCache.syncedAt)}`)
    console.log(`entries : ${report.latestCache.payloadEntries}`)
    console.log('')
    console.log('Counts')
    console.log(`- duplicate playerId groups: ${report.counts.duplicatePlayerIdGroups}`)
    console.log(`- duplicate sleeperId groups: ${report.counts.duplicateSleeperIdGroups}`)
    console.log(`- same headshot + different normalized names: ${report.counts.sameHeadshotDifferentNormalizedNames}`)
    console.log(`- jr/non-jr alias pairs: ${report.counts.jrNonJrAliasPairs}`)
    console.log(`- identity rows missing sleeperId carry-forward: ${report.counts.identityMissingSleeperCarryForward}`)
    console.log(`- rookie signal gaps (non-DEF/K): ${report.counts.rookieSignalGapsNonDefK}`)
    console.log('- rookie gap classes:')
    for (const [k, v] of Object.entries(report.rookieSignalGapClassification)) {
      console.log(`  - ${k}: ${v}`)
    }
    console.log('')
    console.log('Assertions')
    console.log(`- duplicate playerId groups should be zero: ${report.assertions.duplicatePlayerIdGroupsShouldBeZero ? 'PASS' : 'FAIL'}`)
    console.log(`- marvin harrison jr/non-jr alias pair present: ${report.assertions.marvinJrAliasPairPresent ? 'YES' : 'NO'}`)
    console.log('')
    console.log('Top duplicate playerId groups')
    for (const g of report.duplicatePlayerIdGroups) {
      console.log(`- playerId=${g.key} rows=${g.rows.length}`)
      for (const r of g.rows) {
        console.log(`  - ${r.name} | ${r.position}/${r.team ?? 'NA'} | sleeper=${r.sleeperId ?? 'NA'}`)
      }
    }
    console.log('')
    console.log('Top jr/non-jr alias pairs')
    for (const p of report.jrNonJrAliasPairs) {
      const jrNames = unique(p.jrRows.map((r) => r.name)).join(', ')
      const baseNames = unique(p.baseRows.map((r) => r.name)).join(', ')
      console.log(`- key=${p.key}`)
      console.log(`  - jr: ${jrNames}`)
      console.log(`  - base: ${baseNames}`)
    }
    console.log('')
  }

  await prisma.$disconnect()
}

void main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error('[audit-player-identity-collisions] failed:', message)
  try {
    await prisma.$disconnect()
  } catch {
    // ignore
  }
  process.exit(1)
})
