import type { PrismaClient } from '@prisma/client'

import { rosterPlayerIds } from '@/lib/core-app/myRoster'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { computeLeagueProjectedPoints } from '@/lib/projections/leagueScoring'

import type { WaiverValueBasis } from './waiverSportBasis'

/**
 * DB-first reads behind the season-rate waiver boards (NBA, NCAAB, NHL, MLB, NCAAF): the projection
 * pool, and the id hops between it and a league's rosters.
 *
 * Reads Postgres only. The rows are written by `cron/compute-projections`
 * (`writeAfProjectionSnapshots`) and the identity links by the import crons; nothing here calls a
 * provider. The client is injected, like `loadWaiverBoard`'s, so both boards share one read path.
 *
 * ── 🛑 THREE ID SPACES MEET HERE, AND THEY ARE NEVER COMPARED WITH EACH OTHER ──────────────────
 *
 *   projection key   what `AFProjectionSnapshot.playerId` holds: a `PlayerIdentityMap.id` for the
 *                    Rolling Insights sports, a CFBD athlete id for NCAAF (`projectionKeyField`).
 *   league id        what THIS league's rosters hold — a native league's Rolling Insights number,
 *                    an ESPN athlete id, a Fantrax id — named by exactly one identity column
 *                    (`leagueIdColumn`). Sleeper, Rolling Insights, ESPN and CFBD all write small
 *                    numbers, and the same number is a different person in each (Sleeper 9228 is
 *                    Bryce Young; RI 9228 is an offensive tackle), so a league's ids are asked only
 *                    of their own column, scoped to the sport.
 *   Sleeper id       never used for these sports: SportsPlayer carries ZERO Sleeper ids outside the
 *                    NFL (measured 2026-09-29), and `lookupProjections` is not called.
 *
 * Every crossing goes through `PlayerIdentityMap`, and a crossing that lands on two different
 * people is DROPPED, not resolved to the first — only `sleeperId` is unique on that table.
 *
 * ── 🛑 A FREE AGENT HAS TO BE PROVEN FREE ─────────────────────────────────────────────────────
 * A candidate is "on the wire" only when his id IN THIS LEAGUE'S SPACE is known and appears on no
 * roster. A projected player whose identity row carries no id in the league's column cannot be
 * looked for on its rosters at all, so he is left off the board and counted — reading "we could
 * not find him on a roster" as "nobody has him" is how the NFL board once named the best player in
 * football a free agent in an ESPN league.
 */

type Db = Pick<PrismaClient, 'aFProjectionSnapshot' | 'playerIdentityMap'>

/**
 * The share of your roster that must resolve before a league can be priced — the NFL board's
 * `ID_SPACE_FLOOR`, for the same reason: not zero (one coincidental match would pass an unreadable
 * league), not one (a rookie the identity map has not linked would withhold a healthy one).
 */
export const SEASON_RATE_ID_FLOOR = 0.5

/** Every player id on a roster, in whatever shape it is stored; Sleeper's `0` hole is not a player. */
export function allRosterIds(playerData: unknown): string[] {
  return rosterPlayerIds(playerData).filter((id) => id !== '0')
}

/** Starters, in the same shapes. */
export function starterIdsOf(playerData: unknown): Set<string> {
  const out = new Set<string>()
  const raw =
    playerData && typeof playerData === 'object' && !Array.isArray(playerData)
      ? (playerData as Record<string, unknown>).starters
      : null
  if (!Array.isArray(raw)) return out
  for (const x of raw) {
    const id =
      typeof x === 'string' || typeof x === 'number'
        ? String(x).trim()
        : x && typeof x === 'object'
          ? String((x as Record<string, unknown>).playerId ?? (x as Record<string, unknown>).id ?? '').trim()
          : ''
    if (id && id !== '0') out.add(id)
  }
  return out
}

/** The `PlayerIdentityMap` columns a league's roster ids can be written in. */
export type LeagueIdColumn = 'rollingInsightsId' | 'espnId' | 'fantraxId' | 'mflId' | 'fleaflickerId' | 'sleeperId'

const LEAGUE_ID_COLUMNS: readonly LeagueIdColumn[] = [
  'rollingInsightsId',
  'espnId',
  'fantraxId',
  'mflId',
  'fleaflickerId',
  'sleeperId',
]

const PLATFORM_COLUMN: Record<string, LeagueIdColumn> = {
  sleeper: 'sleeperId',
  espn: 'espnId',
  fantrax: 'fantraxId',
  mfl: 'mflId',
  myfantasyleague: 'mflId',
  fleaflicker: 'fleaflickerId',
}

/**
 * The one identity column this league's roster ids live in, or null when no column can hold them
 * (Yahoo, anything unrecognised) — that league is withheld as unreadable, never guessed at.
 *
 * A native (AllFantasy) league outside the NFL rosters Rolling Insights ids: all 72 native NHL
 * roster ids measured on production 2026-09-29 were RI numbers (see resolvePlayerNames.ts). Any
 * other id a native roster holds simply fails to resolve and counts against the resolution floor.
 */
export function leagueIdColumn(platform: string | null | undefined): LeagueIdColumn | null {
  const p = String(platform ?? '').trim().toLowerCase()
  if (isNativePlatform(p || null)) return 'rollingInsightsId'
  return PLATFORM_COLUMN[p] ?? null
}

/** Where a sport's projection key lives on `PlayerIdentityMap`. */
export function projectionKeyField(sport: string): 'id' | 'cfbdId' {
  return sport.trim().toUpperCase() === 'NCAAF' ? 'cfbdId' : 'id'
}

export type SeasonRateRow = {
  /** `AFProjectionSnapshot.playerId` — the projection key, never a league or Sleeper id. */
  key: string
  name: string
  position: string | null
  /** AllFantasy's own per-game points, under its default scoring for the sport. */
  perGame: number
  /** Per-game component rates, for re-scoring under a league's own rules. */
  components: Record<string, unknown> | null
}

type SnapshotRow = {
  playerId: string
  playerName: string
  position: string
  afProjection: number
  adjustmentFactors: unknown
  computedAt: Date
}

const SNAPSHOT_SELECT = {
  playerId: true,
  playerName: true,
  position: true,
  afProjection: true,
  adjustmentFactors: true,
  computedAt: true,
} as const

function componentsOf(adjustmentFactors: unknown): Record<string, unknown> | null {
  if (!adjustmentFactors || typeof adjustmentFactors !== 'object' || Array.isArray(adjustmentFactors)) return null
  const rates = (adjustmentFactors as Record<string, unknown>).perGameRates
  return rates && typeof rates === 'object' && !Array.isArray(rates) ? (rates as Record<string, unknown>) : null
}

/*
 * One row per player, the FRESHEST. A player can hold more than one season-baseline row (the key
 * includes an event id), and taking whichever sorted first would show a stale number as current.
 */
function freshestPerPlayer(rows: readonly SnapshotRow[]): SeasonRateRow[] {
  const best = new Map<string, SnapshotRow>()
  for (const r of rows) {
    const held = best.get(r.playerId)
    if (!held || r.computedAt.getTime() > held.computedAt.getTime()) best.set(r.playerId, r)
  }
  return [...best.values()]
    .filter((r) => Number.isFinite(r.afProjection))
    .map((r) => ({
      key: r.playerId,
      name: r.playerName,
      position: r.position || null,
      perGame: r.afProjection,
      components: componentsOf(r.adjustmentFactors),
    }))
}

/**
 * The newest season holding season-baseline rows for this sport, or null when there are none.
 * Read from the data, never from the calendar: the compute job has stalled for days before.
 */
export async function newestSeasonRateSeason(db: Db, sport: string): Promise<number | null> {
  const row = await db.aFProjectionSnapshot
    .findFirst({ where: { sport, week: null }, orderBy: { season: 'desc' }, select: { season: true } })
    .catch(() => null)
  return row?.season ?? null
}

/**
 * The highest per-game projections in a sport, one row per player. Ordered by the engine's own
 * figure purely to BOUND the pool; every number a board prints is priced per league afterwards.
 */
export async function loadSeasonRatePool(db: Db, sport: string, season: number, take: number): Promise<SeasonRateRow[]> {
  const rows = await db.aFProjectionSnapshot
    .findMany({
      where: { sport, season, week: null },
      orderBy: [{ afProjection: 'desc' }, { computedAt: 'desc' }],
      take,
      select: SNAPSHOT_SELECT,
    })
    .catch(() => [] as SnapshotRow[])
  return freshestPerPlayer(rows as SnapshotRow[])
}

/** Season-baseline rows for specific projection keys — a roster's players, who may sit outside the pool. */
export async function loadSeasonRateRows(
  db: Db,
  sport: string,
  season: number,
  keys: readonly string[],
): Promise<Map<string, SeasonRateRow>> {
  const ids = [...new Set(keys.filter(Boolean))]
  if (ids.length === 0) return new Map()
  const rows = await db.aFProjectionSnapshot
    .findMany({ where: { sport, season, week: null, playerId: { in: ids } }, select: SNAPSHOT_SELECT })
    .catch(() => [] as SnapshotRow[])
  return new Map(freshestPerPlayer(rows as SnapshotRow[]).map((r) => [r.key, r]))
}

/** What the identity map knows about one projection key. */
export type KeyIdentity = {
  team: string | null
  /** The key's id in each league column; `null` when the column is empty on every row for it. */
  ids: Partial<Record<LeagueIdColumn, string | null>>
  /** Columns where two rows for this one key disagree — the key must not be used in them at all. */
  ambiguous: Set<LeagueIdColumn>
}

type IdentityRow = { id: string; cfbdId: string | null; currentTeam: string | null } & Record<LeagueIdColumn, string | null>

const IDENTITY_SELECT = {
  id: true,
  cfbdId: true,
  currentTeam: true,
  rollingInsightsId: true,
  espnId: true,
  fantraxId: true,
  mflId: true,
  fleaflickerId: true,
  sleeperId: true,
} as const

/** Identity for each projection key, scoped to the sport. One read. */
export async function loadIdentityForKeys(
  db: Db,
  sport: string,
  keys: readonly string[],
): Promise<Map<string, KeyIdentity>> {
  const ids = [...new Set(keys.filter(Boolean))]
  if (ids.length === 0) return new Map()
  const field = projectionKeyField(sport)
  const rows = (await db.playerIdentityMap
    .findMany({ where: { sport, [field]: { in: ids } }, select: IDENTITY_SELECT })
    .catch(() => [])) as IdentityRow[]

  const out = new Map<string, KeyIdentity>()
  for (const r of rows) {
    const key = field === 'id' ? r.id : r.cfbdId
    if (!key) continue
    const held: KeyIdentity = out.get(key) ?? { team: null, ids: {}, ambiguous: new Set() }
    held.team = held.team ?? r.currentTeam ?? null
    for (const col of LEAGUE_ID_COLUMNS) {
      const v = r[col] ? String(r[col]).trim() : null
      const prev = held.ids[col]
      if (prev == null) held.ids[col] = v
      else if (v != null && v !== prev) held.ambiguous.add(col)
    }
    out.set(key, held)
  }
  return out
}

/** A key's id in this league's column, or null when it has none or it is contradicted. */
export function leagueIdOf(identity: KeyIdentity | undefined, column: LeagueIdColumn): string | null {
  if (!identity || identity.ambiguous.has(column)) return null
  return identity.ids[column] ?? null
}

/**
 * Roster ids -> projection keys, through this league's ONE identity column, scoped to the sport.
 *
 * ⚠ A ROSTER ID MATCHING TWO DIFFERENT PEOPLE IS DROPPED. The provider columns are not unique on
 * `PlayerIdentityMap`, and a wrong link here prices a stranger as your bench player.
 */
export async function resolveRosterIdsToKeys(
  db: Db,
  sport: string,
  column: LeagueIdColumn,
  rosterIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(rosterIds.map((x) => String(x).trim()).filter(Boolean))]
  if (ids.length === 0) return new Map()
  const field = projectionKeyField(sport)
  const rows = (await db.playerIdentityMap
    .findMany({ where: { sport, [column]: { in: ids } }, select: IDENTITY_SELECT })
    .catch(() => [])) as IdentityRow[]

  const claims = new Map<string, string | null>()
  for (const r of rows) {
    const from = r[column] ? String(r[column]).trim() : ''
    const to = field === 'id' ? r.id : r.cfbdId
    if (!from || !to) continue
    if (!claims.has(from)) claims.set(from, to)
    else if (claims.get(from) !== to) claims.set(from, null)
  }
  const out = new Map<string, string>()
  for (const [from, to] of claims) if (to) out.set(from, to)
  return out
}

/**
 * One player's per-game value on this basis, or null when it cannot be priced.
 *
 * ⚠ NEVER A MIX. Under the league basis a player whose line the league's rules cannot score is
 * null — never his default-scored figure beside everyone else's league-scored one, which would rank
 * two currencies against each other.
 */
export function priceSeasonRate(
  row: SeasonRateRow,
  basis: WaiverValueBasis,
  scoring: Record<string, unknown> | null,
): number | null {
  if (basis === 'season_per_game_af_default') return Number.isFinite(row.perGame) ? row.perGame : null
  if (basis === 'season_per_game_league') {
    if (!scoring || !row.components) return null
    const scored = computeLeagueProjectedPoints(row.components, scoring)
    return scored ? scored.points : null
  }
  return null
}
