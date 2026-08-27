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
import { buildDevyValueBoard } from '@/lib/devy/devyValueBoard'
import { getEligibleDevyPlayers } from '@/lib/devy-classification'
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
  draftProjectionScore: true,
  recruitingComposite: true,
  breakoutAge: true,
  devyAdp: true,
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
  draftProjectionScore: number | null
  recruitingComposite: number | null
  breakoutAge: number | null
  devyAdp: number | null
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

function toDevyPlayerValue(
  row: DevyRow,
  board: Map<string, { value: number | null; rank: number | null }>,
): DevyPlayerValue {
  const ranked = board.get(row.id)
  return {
    name: row.name,
    team: row.school,
    position: row.position,
    classYear: classYearString(row.classYear),
    // Board points, or null when unranked. NEVER the stored devyValue: that is
    // a position-and-class lookup which is 0 for most of the pool, so it cannot
    // distinguish "unscouted" from "worth nothing".
    devyValue: ranked?.value ?? null,
    devyRank: ranked?.rank ?? null,
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
 * The ranked devy board, cached briefly in process.
 *
 * ⚠ IT MUST BE BUILT FROM THE WHOLE POOL, NOT FROM THE ROWS BEING RETURNED.
 * Rank is relative, so a board built from one team's roster makes its best
 * depth piece the number one devy asset in the world. `legacy/devy-board`
 * flags the same trap: a shortlist "reads as a class of blue chips".
 *
 * So this loads the eligible pool once and every read joins to it by id. The
 * cache is short and in-process — the board only moves when the intel feeds
 * run, which is at most daily.
 */
const BOARD_TTL_MS = 5 * 60 * 1000
let boardCache: { at: number; byId: Map<string, { value: number | null; rank: number | null }> } | null = null

async function getDevyBoardIndex(): Promise<Map<string, { value: number | null; rank: number | null }>> {
  if (boardCache && Date.now() - boardCache.at < BOARD_TTL_MS) return boardCache.byId

  // `requireProjection` drops players nothing has scouted rather than ranking
  // them off the bottom — being unranked is the honest answer for them, and it
  // is what makes a null value meaningful further down.
  const pool = await getEligibleDevyPlayers({ requireProjection: true, limit: 2000 }).catch(() => [])
  const board = buildDevyValueBoard(
    (pool as Array<Record<string, unknown>>).map((p) => ({
      id: String(p.id ?? ''),
      name: String(p.name ?? ''),
      position: (p.position as string) ?? null,
      school: (p.school as string) ?? null,
      draftEligibleYear: (p.draftEligibleYear as number) ?? null,
      classYear: (p.classYear as number) ?? null,
      draftProjectionScore: (p.draftProjectionScore as number) ?? null,
      recruitingComposite: (p.recruitingComposite as number) ?? null,
      breakoutAge: (p.breakoutAge as number) ?? null,
      projectedDraftRound: (p.projectedDraftRound as number) ?? null,
      devyAdp: (p.devyAdp as number) ?? null,
    })),
    new Date().getFullYear(),
  )

  const byId = new Map<string, { value: number | null; rank: number | null }>()
  for (const entry of board.entries) {
    if (entry.id) byId.set(entry.id, { value: entry.value.value, rank: entry.devyRank })
  }
  boardCache = { at: Date.now(), byId }
  return byId
}

/*
 * ⚠ DO NOT RANK ON `devyValue`. It is a position-and-class-year lookup with no
 * player-specific input, and it is 0 for 1,237 of 1,718 rows in production —
 * every player without a stat line, which for devy is most of the asset class.
 * Ordering by it leaves 72% of the pool tied at zero in arbitrary order, so a
 * team roster read returned a handful of statted players and then noise.
 *
 * `lib/devy/devyValueBoard.ts` reached the same conclusion and says so in its
 * own header — it ranks on `draftProjectionScore` and never reads devyValue.
 * This matches that, so the two do not disagree about who the best prospect is.
 *
 * `devyValue` stays as the SECOND key rather than being dropped: where a
 * projection is missing it still separates a statted player from an empty row,
 * which is better than falling straight through to alphabetical.
 */
const DEVY_RANK_ORDER = [
  { draftProjectionScore: 'desc' as const },
  { devyValue: 'desc' as const },
  { name: 'asc' as const },
]

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
    orderBy: DEVY_RANK_ORDER,
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
    orderBy: DEVY_RANK_ORDER,
  })

  const board = await getDevyBoardIndex()
  return rows.map((row) => toDevyPlayerValue(row, board))
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
    orderBy: DEVY_RANK_ORDER,
  })

  // First row per normalized name wins — ordered by draft projection, so when the
  // same name exists at two schools the better-projected prospect is returned.
  const byName = new Map<string, DevyRow>()
  for (const row of rows) if (!byName.has(row.normalizedName)) byName.set(row.normalizedName, row)

  const board = await getDevyBoardIndex()
  return normalized.map((n) => {
    const row = byName.get(n)
    return row ? toDevyPlayerValue(row, board) : null
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
