import { prisma } from '@/lib/prisma'

import { isValidSourceSlug, parsePlayerKey } from './playerKey'
import { isDynastyProspectStorageEnabled, type FlagEnv } from './storageFlag'
import { toProspectSport, type ProspectStatus } from './vendorAdapter'

/**
 * The DB-first READ layer over `prospect_players` and `rookie_eligibility_records`. Request paths
 * read prospects through here and nowhere else — never from a vendor (CLAUDE.md "DB-first boundary").
 *
 * 🛑 EVERY READ IS EMPTY, AND MAKES NO QUERY, WHILE DYNASTY_PROSPECT_STORAGE_ENABLED IS OFF. The tables
 * arrive with migration `20261020180000_dynasty_prospect_storage`, which the owner has not applied;
 * a query against a missing table raises P2021. ./storageFlag.ts says why a flag and not a catch.
 *
 * 🛑 NOTHING CALLS THIS YET. Wiring the draft room to `loadRookieEligibility` belongs with the first
 * vendor import and its scheduled writer, in one change: a surface pointed at a table nothing
 * refreshes reads "no rookies" and looks correct.
 */

type ProspectReadDb = Pick<typeof prisma, 'prospectPlayer' | 'rookieEligibilityRecord'>

type ReadOpts = { db?: ProspectReadDb; env?: FlagEnv }

const KEY_CHUNK = 1000

export type RookieEligibilityVerdict = {
  playerKey: string
  isRookie: boolean
  /** The source whose verdict won (see `sourcePriority`). */
  source: string
  basis: string
  computedAt: Date
  /** True when two sources disagree about this player. The winner is still returned. */
  conflict: boolean
  /** Every source's verdict, winner first. */
  sources: Array<{ source: string; isRookie: boolean; basis: string; computedAt: Date }>
}

/**
 * Rookie verdicts for these players in this sport + season, keyed by the player key asked for.
 *
 * Keys must be namespaced (./playerKey.ts); a bare id is DROPPED, not looked up, because it would
 * match whichever id space happens to use that number. A player with no stored verdict is simply
 * absent from the map — absence means "unknown", never "not a rookie".
 *
 * When sources disagree, the first source in `sourcePriority` wins; sources not listed come after,
 * newest verdict first. `conflict` says it happened so a caller can decline to act on it.
 */
export async function loadRookieEligibility(
  sportInput: string,
  season: number,
  playerKeys: readonly string[],
  opts: ReadOpts & { sourcePriority?: readonly string[] } = {},
): Promise<Map<string, RookieEligibilityVerdict>> {
  const out = new Map<string, RookieEligibilityVerdict>()
  if (!isDynastyProspectStorageEnabled(opts.env)) return out
  const sport = toProspectSport(sportInput)
  if (!sport || !Number.isInteger(season)) return out
  const keys = [...new Set(playerKeys.map((k) => String(k ?? '').trim()).filter((k) => parsePlayerKey(k) !== null))]
  if (keys.length === 0) return out
  const db = opts.db ?? prisma

  const rows: Array<{ playerKey: string; isRookie: boolean; source: string; basis: string; computedAt: Date }> = []
  for (let i = 0; i < keys.length; i += KEY_CHUNK) {
    rows.push(
      ...(await db.rookieEligibilityRecord.findMany({
        where: { sport, season, playerKey: { in: keys.slice(i, i + KEY_CHUNK) } },
        select: { playerKey: true, isRookie: true, source: true, basis: true, computedAt: true },
      })),
    )
  }

  const priority = opts.sourcePriority ?? []
  const rank = (source: string) => {
    const i = priority.indexOf(source)
    return i < 0 ? priority.length : i
  }
  const byKey = new Map<string, typeof rows>()
  for (const row of rows) {
    const list = byKey.get(row.playerKey) ?? []
    list.push(row)
    byKey.set(row.playerKey, list)
  }
  for (const [playerKey, list] of byKey) {
    list.sort((a, b) => rank(a.source) - rank(b.source) || b.computedAt.getTime() - a.computedAt.getTime())
    const [winner] = list
    out.set(playerKey, {
      playerKey,
      isRookie: winner.isRookie,
      source: winner.source,
      basis: winner.basis,
      computedAt: winner.computedAt,
      conflict: list.some((r) => r.isRookie !== winner.isRookie),
      sources: list.map(({ source, isRookie, basis, computedAt }) => ({ source, isRookie, basis, computedAt })),
    })
  }
  return out
}

export type ProspectPoolEntry = {
  id: string
  sport: string
  source: string
  sourcePlayerId: string
  name: string
  position: string | null
  birthDate: Date | null
  currentOrg: string | null
  currentTeam: string | null
  currentLevel: string | null
  draftYear: number | null
  draftRound: number | null
  draftPick: number | null
  draftOverall: number | null
  draftTeam: string | null
  etaYear: number | null
  status: string
  sportsPlayerId: string | null
  lastSyncedAt: Date
}

const POOL_SELECT = {
  id: true,
  sport: true,
  source: true,
  sourcePlayerId: true,
  name: true,
  position: true,
  birthDate: true,
  currentOrg: true,
  currentTeam: true,
  currentLevel: true,
  draftYear: true,
  draftRound: true,
  draftPick: true,
  draftOverall: true,
  draftTeam: true,
  etaYear: true,
  status: true,
  sportsPlayerId: true,
  lastSyncedAt: true,
} as const

const DEFAULT_POOL_LIMIT = 500
const MAX_POOL_LIMIT = 2000

/**
 * One sport's prospect pool, best draft capital first (overall pick ascending, undrafted last).
 * Defaults to `status: 'prospect'` — graduated rows are kept in the table but are not prospects.
 */
export async function loadProspectPool(
  sportInput: string,
  opts: ReadOpts & { status?: ProspectStatus | 'any'; source?: string; draftYear?: number; limit?: number } = {},
): Promise<ProspectPoolEntry[]> {
  if (!isDynastyProspectStorageEnabled(opts.env)) return []
  const sport = toProspectSport(sportInput)
  if (!sport) return []
  if (opts.source !== undefined && !isValidSourceSlug(opts.source)) return []
  const status = opts.status ?? 'prospect'
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? DEFAULT_POOL_LIMIT)), MAX_POOL_LIMIT)
  const db = opts.db ?? prisma
  return db.prospectPlayer.findMany({
    where: {
      sport,
      ...(status === 'any' ? {} : { status }),
      ...(opts.source ? { source: opts.source } : {}),
      ...(opts.draftYear !== undefined ? { draftYear: opts.draftYear } : {}),
    },
    orderBy: [{ draftOverall: { sort: 'asc', nulls: 'last' } }, { normalizedName: 'asc' }],
    take: limit,
    select: POOL_SELECT,
  })
}

/**
 * Prospects by a vendor's own ids, keyed by that id. `source` is REQUIRED: a vendor id without its
 * source is the unscoped lookup lib/player-identity/externalIdNamespace.ts exists to prevent.
 */
export async function loadProspectsBySourceIds(
  sportInput: string,
  source: string,
  sourcePlayerIds: readonly string[],
  opts: ReadOpts = {},
): Promise<Map<string, ProspectPoolEntry>> {
  const out = new Map<string, ProspectPoolEntry>()
  if (!isDynastyProspectStorageEnabled(opts.env)) return out
  const sport = toProspectSport(sportInput)
  if (!sport || !isValidSourceSlug(source)) return out
  const ids = [...new Set(sourcePlayerIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
  if (ids.length === 0) return out
  const db = opts.db ?? prisma
  for (let i = 0; i < ids.length; i += KEY_CHUNK) {
    const rows = await db.prospectPlayer.findMany({
      where: { sport, source, sourcePlayerId: { in: ids.slice(i, i + KEY_CHUNK) } },
      select: POOL_SELECT,
    })
    for (const row of rows) out.set(row.sourcePlayerId, row)
  }
  return out
}
