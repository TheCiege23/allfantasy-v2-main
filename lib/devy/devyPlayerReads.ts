import 'server-only'

/**
 * DB-first reads of the college/devy player pool.
 *
 * WHY THIS MODULE EXISTS. `lib/cfb-player-data.ts` is the CollegeFootballData
 * ADAPTER — every function in it performs a live vendor fetch. Two request
 * paths imported it directly (`/api/market-alerts` and `/api/legacy/cfb-players`),
 * which put a provider round-trip on the user's request, inherited CFBD's
 * latency and rate limit, and returned an empty page whenever the vendor
 * blipped. `/api/legacy/cfb-players?action=fantrax-roster` was the worst of it:
 * one `searchCFBPlayers` call per rostered player, up to 50 sequential vendor
 * round-trips inside a single GET.
 *
 * Everything those surfaces needed is already in `DevyPlayer`, written by the
 * ingestion path in `lib/devy-classification.ts` and kept current by the
 * `devyPool` and `devyStats` phases of `/api/cron/import-players`. This module
 * reads that table and returns the SAME shapes the adapter did, so the callers
 * change one import and nothing else.
 *
 * SCOPE IS NOT UNIVERSAL, AND CALLERS MUST NOT PRETEND IT IS. The pool covers
 * TOP_CFB_TEAMS schools and QB/RB/WR/TE only. A player outside that scope is
 * genuinely absent rather than temporarily missing, and these functions return
 * an empty result for them — the same thing the live adapter returned whenever
 * CFBD was unreachable, except now it is honest and instant.
 */

import { prisma } from '@/lib/prisma'
import type { CFBPlayer, CFBPlayerStats, DevyPlayerValue } from '@/lib/cfb-player-data'

/** Mirrors normalizeName in lib/devy-classification.ts — the key rows are stored under. */
export function normalizeDevyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function classYearString(year: number | null): string {
  switch (year) {
    case 1: return 'FR'
    case 2: return 'SO'
    case 3: return 'JR'
    case 4: return 'SR'
    case 5: return '5th'
    default: return 'Unknown'
  }
}

function draftEligibleYearFor(row: { draftEligibleYear: number | null; classYear: number | null }): number {
  if (row.draftEligibleYear != null) return row.draftEligibleYear
  // Same fallback the adapter used, kept so a row seeded before the column
  // existed still reports a year rather than NaN.
  const currentYear = new Date().getFullYear()
  return currentYear + Math.max(0, 4 - (row.classYear ?? 3))
}

/** The columns every read here needs; keeps the selects identical and narrow. */
const DEVY_SELECT = {
  id: true,
  name: true,
  normalizedName: true,
  position: true,
  school: true,
  classYear: true,
  heightInches: true,
  weightLbs: true,
  cfbdId: true,
  jerseyNumber: true,
  devyValue: true,
  projectedNFLValue: true,
  projectedDraftRound: true,
  draftEligibleYear: true,
  trend: true,
  passingYards: true,
  passingTDs: true,
  rushingYards: true,
  rushingTDs: true,
  receivingYards: true,
  receivingTDs: true,
  receptions: true,
  statSeason: true,
} as const

type DevyRow = {
  id: string
  name: string
  normalizedName: string
  position: string
  school: string
  classYear: number | null
  heightInches: number | null
  weightLbs: number | null
  cfbdId: string | null
  jerseyNumber: string | null
  devyValue: number
  projectedNFLValue: number | null
  projectedDraftRound: number | null
  draftEligibleYear: number | null
  trend: string
  passingYards: number | null
  passingTDs: number | null
  rushingYards: number | null
  rushingTDs: number | null
  receivingYards: number | null
  receivingTDs: number | null
  receptions: number | null
  statSeason: number | null
}

function toCFBPlayer(row: DevyRow): CFBPlayer {
  const parts = row.name.trim().split(/\s+/)
  const firstName = parts[0] ?? ''
  const lastName = parts.slice(1).join(' ')
  const jersey = row.jerseyNumber ? Number.parseInt(row.jerseyNumber, 10) : NaN

  return {
    // CFBPlayer.id is numeric in the adapter's shape. `cfbdId` is that same id
    // stored as text; a row seeded without one yields 0 rather than NaN, which
    // would serialize to null and read as "the API lost the id".
    id: row.cfbdId ? Number.parseInt(row.cfbdId, 10) || 0 : 0,
    firstName,
    lastName,
    fullName: row.name,
    team: row.school,
    position: row.position,
    jersey: Number.isNaN(jersey) ? null : jersey,
    year: row.classYear,
    height: row.heightInches,
    weight: row.weightLbs,
    // Hometown is not carried on DevyPlayer. Reported as absent rather than
    // guessed — see the recruitingCity/recruitingState note in getDevyPlayer.
    hometown: null,
    homeState: null,
    homeCountry: null,
  }
}

function toDevyPlayerValue(row: DevyRow): DevyPlayerValue {
  return {
    name: row.name,
    team: row.school,
    position: row.position,
    classYear: classYearString(row.classYear),
    devyValue: row.devyValue ?? 0,
    projectedNFLValue: row.projectedNFLValue,
    draftEligibleYear: draftEligibleYearFor(row),
    projectedRound: row.projectedDraftRound,
    trend: (row.trend === 'rising' || row.trend === 'falling' ? row.trend : 'stable'),
    notes: null,
  }
}

function toCFBPlayerStats(row: DevyRow): CFBPlayerStats {
  return {
    playerId: row.cfbdId ? Number.parseInt(row.cfbdId, 10) || 0 : 0,
    playerName: row.name,
    team: row.school,
    position: row.position,
    passingYards: row.passingYards ?? 0,
    passingTDs: row.passingTDs ?? 0,
    rushingYards: row.rushingYards ?? 0,
    rushingTDs: row.rushingTDs ?? 0,
    receivingYards: row.receivingYards ?? 0,
    receivingTDs: row.receivingTDs ?? 0,
    receptions: row.receptions ?? 0,
  }
}

/**
 * Name search over the devy pool.
 *
 * Matches on `normalizedName` so a search for "Travis Hunter Jr." finds the row
 * stored as "travis hunter", which a raw `contains` on `name` would miss.
 */
export async function searchDevyPlayersFromDb(searchTerm: string, limit = 25): Promise<CFBPlayer[]> {
  const needle = normalizeDevyName(searchTerm)
  if (needle.length < 2) return []

  const rows = await prisma.devyPlayer.findMany({
    where: { normalizedName: { contains: needle } },
    select: DEVY_SELECT,
    take: limit,
    orderBy: [{ devyValue: 'desc' }, { name: 'asc' }],
  })

  return rows.map(toCFBPlayer)
}

/** Full fantasy-position roster for one school, with devy values attached. */
export async function getDevyTeamRosterFromDb(team: string, limit = 200): Promise<DevyPlayerValue[]> {
  const rows = await prisma.devyPlayer.findMany({
    where: {
      school: { equals: team, mode: 'insensitive' },
      position: { in: ['QB', 'RB', 'WR', 'TE'] },
    },
    select: DEVY_SELECT,
    take: limit,
    orderBy: [{ devyValue: 'desc' }, { name: 'asc' }],
  })

  return rows.map(toDevyPlayerValue)
}

/**
 * Devy values for a list of names, resolved in ONE query.
 *
 * The adapter did a vendor round-trip per name, sequentially. Names that do not
 * resolve are returned as `null` at their original index so the caller can tell
 * "not in the pool" from "value is zero" — the previous behaviour invented a
 * value from a hardcoded 'JR' default whenever the lookup missed, which is
 * indistinguishable from a real one downstream.
 */
export async function getDevyValuesForNamesFromDb(
  names: string[],
): Promise<Array<DevyPlayerValue | null>> {
  const normalized = names.map((n) => normalizeDevyName(n))
  const lookup = [...new Set(normalized)].filter((n) => n.length >= 2)
  if (lookup.length === 0) return names.map(() => null)

  const rows = await prisma.devyPlayer.findMany({
    where: { normalizedName: { in: lookup } },
    select: DEVY_SELECT,
    orderBy: { devyValue: 'desc' },
  })

  // First row per normalized name wins — ordered by devyValue, so when the same
  // name exists at two schools the more valuable prospect is the one returned.
  const byName = new Map<string, DevyRow>()
  for (const row of rows) if (!byName.has(row.normalizedName)) byName.set(row.normalizedName, row)

  return normalized.map((n) => {
    const row = byName.get(n)
    return row ? toDevyPlayerValue(row) : null
  })
}

/**
 * Season stat lines for the devy pool, keyed by normalized name.
 *
 * Replaces a per-school live fetch loop. `schools` narrows the read for callers
 * that already know their scope; omitting it reads the whole pool.
 */
export async function getDevyStatsByNameFromDb(
  schools?: string[],
): Promise<Map<string, CFBPlayerStats>> {
  const rows = await prisma.devyPlayer.findMany({
    where: {
      ...(schools && schools.length > 0 ? { school: { in: schools } } : {}),
      // Only rows the stat phase has actually written. Without this every
      // unstatted player would come back as a line of zeroes, which reads as
      // "played and produced nothing" rather than "we have no stats yet".
      statSeason: { not: null },
    },
    select: DEVY_SELECT,
    orderBy: { statSeason: 'desc' },
  })

  const byName = new Map<string, CFBPlayerStats>()
  for (const row of rows) {
    if (!byName.has(row.normalizedName)) byName.set(row.normalizedName, toCFBPlayerStats(row))
  }
  return byName
}
