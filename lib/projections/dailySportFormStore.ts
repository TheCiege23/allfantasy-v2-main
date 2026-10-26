import 'server-only'

import type { PrismaClient } from '@prisma/client'

import { getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { buildSeasonTotalsForm, seasonTotalsBlockersForSport, type SeasonTotalsRow } from './dailySportSeasonTotals'
import {
  buildDailySportForm,
  isDailyFormSport,
  type DailySportFormBlob,
  type GameLogRow,
} from './dailySportForm'

/**
 * Storage for the daily-sport form lines (dailySportForm.ts): one `sportsDataCache` row per sport and
 * season, plus a pointer to the newest season. No migration — the shape is one JSON object per sport.
 *
 * WRITER: `writeDailySportFormCache`, called only from `/api/cron/import-player-game-stats?multiSport=1`
 * right after that run refreshes `player_game_stats` — the table this is derived from — so the two
 * cannot drift apart by more than one run. It also keeps LAST season's lines (season - 1, rebuilt at
 * most weekly) for the prior-season blend. READERS: `readDailySportForm` and `readPriorDailySportForm`,
 * for request paths. Neither side calls a provider.
 */

type Db = Pick<PrismaClient, 'playerGameStat' | 'playerIdentityMap' | 'playerSeasonStats' | 'sportsDataCache'>

const KEY_PREFIX = 'af-daily-form:v1'
export const dailyFormKey = (sport: string, season: number) => `${KEY_PREFIX}:${sport.toUpperCase()}:${season}`
export const dailyFormPointerKey = (sport: string) => `${KEY_PREFIX}:${sport.toUpperCase()}:latest`

/**
 * A week without a rebuild is a stale reading, not a missing one; past this the reader declines rather
 * than print last month's form as this week's.
 */
const TTL_MS = 7 * 24 * 60 * 60 * 1000
const ROW_BATCH = 10_000
const ID_BATCH = 5_000

export type WriteDailyFormResult = {
  sport: string
  season: number | null
  rowsRead: number
  players: number
  written: boolean
  reason?: string
  /** Last season's lines, for the prior-season blend. */
  prior?: PriorFormResult
}

export type PriorFormResult = {
  season: number
  players: number
  written: boolean
  reason?: string
  /** Set when last season came from `player_season_stats` totals rather than game lines. */
  basis?: 'season_totals'
}

export async function writeDailySportFormCache(
  db: Db,
  sport: string,
  opts: { now?: Date; dryRun?: boolean } = {},
): Promise<WriteDailyFormResult> {
  const s = sport.toUpperCase()
  const now = opts.now ?? new Date()
  const normalizer = getDailySportNormalizer(s)
  if (!isDailyFormSport(s) || !normalizer) {
    return { sport: s, season: null, rowsRead: 0, players: 0, written: false, reason: 'not_a_daily_form_sport' }
  }

  // The newest season holding game lines, read from the data rather than the calendar.
  const newest = await db.playerGameStat.findFirst({
    where: { sportType: s },
    orderBy: { season: 'desc' },
    select: { season: true },
  })
  if (!newest) return { sport: s, season: null, rowsRead: 0, players: 0, written: false, reason: 'no_game_lines' }
  const season = newest.season

  const rows = await readSeasonRows(db, s, season)
  const blob = await buildBlob(db, s, season, rows, normalizer, now)
  const players = Object.keys(blob.players).length
  if (players === 0) return { sport: s, season, rowsRead: rows.length, players: 0, written: false, reason: 'no_regular_season_games' }
  // Last season's lines are an input to the blend, never a condition of this season's write.
  const prior = await writePriorSeasonForm(db, s, season - 1, normalizer, now, Boolean(opts.dryRun)).catch(
    (err: unknown): PriorFormResult => ({ season: season - 1, players: 0, written: false, reason: `error: ${String(err).slice(0, 120)}` }),
  )
  if (opts.dryRun) return { sport: s, season, rowsRead: rows.length, players, written: false, reason: 'dry_run', prior }

  const expiresAt = new Date(now.getTime() + TTL_MS)
  const data = blob as unknown as object
  await db.sportsDataCache.upsert({
    where: { cacheKey: dailyFormKey(s, season) },
    create: { cacheKey: dailyFormKey(s, season), data, expiresAt },
    update: { data, expiresAt },
  })
  const pointer = { season, computedAt: blob.computedAt }
  await db.sportsDataCache.upsert({
    where: { cacheKey: dailyFormPointerKey(s) },
    create: { cacheKey: dailyFormPointerKey(s), data: pointer, expiresAt },
    update: { data: pointer, expiresAt },
  })
  return { sport: s, season, rowsRead: rows.length, players, written: true, prior }
}

/**
 * LAST season's lines, for the prior-season blend (PRIOR_SEASON_BLEND_GAMES in dailySportForm.ts).
 * Read from the same `player_game_stats` rows, keyed by season. A finished season does not change, so
 * it is rebuilt at most once per PRIOR_REBUILD_MS rather than on every nightly run, and held for
 * PRIOR_TTL_MS.
 *
 * No game lines for that season: SEASON TOTALS from `player_season_stats` instead, for a sport whose
 * default scoring they map completely (dailySportSeasonTotals.ts — NHL today; NBA and MLB are blocked by
 * per-game categories). Otherwise nothing is written, and the reader falls back to this season. Game
 * lines always win: a held totals blob is rebuilt the night game lines for its season appear.
 */
const PRIOR_TTL_MS = 30 * 24 * 60 * 60 * 1000
const PRIOR_REBUILD_MS = TTL_MS

async function writePriorSeasonForm(
  db: Db,
  sport: string,
  season: number,
  normalizer: Normalizer,
  now: Date,
  dryRun: boolean,
): Promise<PriorFormResult> {
  const held = await db.sportsDataCache.findUnique({ where: { cacheKey: dailyFormKey(sport, season) } })
  const heldAt = Date.parse(String((held?.data as { computedAt?: unknown } | null)?.computedAt ?? ''))
  const heldTotals = (held?.data as { basis?: unknown } | null)?.basis === 'season_totals'
  const fresh = held && held.expiresAt > now && Number.isFinite(heldAt) && now.getTime() - heldAt < PRIOR_REBUILD_MS
  if (fresh && !(heldTotals && (await hasGameLines(db, sport, season)))) {
    return {
      season,
      players: Object.keys((held.data as { players?: object }).players ?? {}).length,
      written: false,
      reason: 'fresh',
      ...(heldTotals ? { basis: 'season_totals' as const } : {}),
    }
  }
  const rows = await readSeasonRows(db, sport, season)
  let blob: DailySportFormBlob
  if (rows.length > 0) {
    blob = await buildBlob(db, sport, season, rows, normalizer, now)
  } else {
    if (seasonTotalsBlockersForSport(sport).length > 0) {
      return { season, players: 0, written: false, reason: 'no_prior_season_game_lines' }
    }
    blob = await buildSeasonTotalsBlob(db, sport, season, now)
  }
  const basis = blob.basis === 'season_totals' ? { basis: 'season_totals' as const } : {}
  const players = Object.keys(blob.players).length
  if (players === 0) {
    return { season, players: 0, written: false, reason: basis.basis ? 'no_prior_season_totals' : 'no_regular_season_games', ...basis }
  }
  if (dryRun) return { season, players, written: false, reason: 'dry_run', ...basis }
  const expiresAt = new Date(now.getTime() + PRIOR_TTL_MS)
  const data = blob as unknown as object
  await db.sportsDataCache.upsert({
    where: { cacheKey: dailyFormKey(sport, season) },
    create: { cacheKey: dailyFormKey(sport, season), data, expiresAt },
    update: { data, expiresAt },
  })
  return { season, players, written: true, ...basis }
}

async function hasGameLines(db: Db, sport: string, season: number): Promise<boolean> {
  return Boolean(await db.playerGameStat.findFirst({ where: { sportType: sport, season }, select: { season: true } }))
}

/**
 * Last season from Rolling Insights' regular-season totals, the only source `player_season_stats`
 * holds for these sports with games played. Its rows are keyed on RI's player id; the game lines, and
 * so the blob, on the identity id — translated through `PlayerIdentityMap.rollingInsightsId`. An RI id
 * that maps to two identity rows is left out rather than credited to either.
 */
async function buildSeasonTotalsBlob(db: Db, sport: string, season: number, now: Date): Promise<DailySportFormBlob> {
  const raw = await db.playerSeasonStats.findMany({
    where: { sport, season: String(season), seasonType: 'regular', source: 'rolling_insights' },
    select: { playerId: true, stats: true, gamesPlayed: true, team: true },
  })
  const riIds = [...new Set(raw.map((r) => r.playerId))]
  const byRi = new Map<string, Array<{ id: string; position: string | null }>>()
  for (let i = 0; i < riIds.length; i += ID_BATCH) {
    const found = await db.playerIdentityMap.findMany({
      where: { sport, rollingInsightsId: { in: riIds.slice(i, i + ID_BATCH) } },
      select: { id: true, position: true, rollingInsightsId: true },
    })
    for (const f of found) {
      if (!f.rollingInsightsId) continue
      const list = byRi.get(f.rollingInsightsId) ?? []
      list.push({ id: f.id, position: f.position ?? null })
      byRi.set(f.rollingInsightsId, list)
    }
  }
  const rows: SeasonTotalsRow[] = []
  const identityPositions = new Map<string, string | null>()
  for (const r of raw) {
    const ids = byRi.get(r.playerId)
    if (!ids || ids.length !== 1) continue
    rows.push({ playerId: ids[0]!.id, stats: r.stats, gamesPlayed: r.gamesPlayed, team: r.team })
    identityPositions.set(ids[0]!.id, ids[0]!.position)
  }
  return buildSeasonTotalsForm({ sport, season, rows, identityPositions, computedAt: now })
}

type Normalizer = NonNullable<ReturnType<typeof getDailySportNormalizer>>

async function readSeasonRows(db: Db, s: string, season: number): Promise<GameLogRow[]> {
  const rows: GameLogRow[] = []
  let cursor: string | undefined
  for (;;) {
    const batch = await db.playerGameStat.findMany({
      where: { sportType: s, season },
      select: {
        id: true,
        playerId: true,
        gameId: true,
        providerGameId: true,
        gameDate: true,
        season: true,
        team: true,
        normalizedStatMap: true,
      },
      orderBy: { id: 'asc' },
      take: ROW_BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
    for (const r of batch) rows.push(r)
    if (batch.length < ROW_BATCH) break
    cursor = batch[batch.length - 1]!.id
  }
  return rows
}

async function buildBlob(
  db: Db,
  s: string,
  season: number,
  rows: readonly GameLogRow[],
  normalizer: Normalizer,
  now: Date,
): Promise<DailySportFormBlob> {
  const ids = [...new Set(rows.map((r) => r.playerId))]
  const identityPositions = new Map<string, string | null>()
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const found = await db.playerIdentityMap.findMany({
      where: { sport: s, id: { in: ids.slice(i, i + ID_BATCH) } },
      select: { id: true, position: true },
    })
    for (const f of found) identityPositions.set(f.id, f.position ?? null)
  }

  return buildDailySportForm({ sport: s, season, rows, identityPositions, normalizer, computedAt: now })
}

function isBlob(v: unknown, sport: string): v is DailySportFormBlob {
  const b = v as Partial<DailySportFormBlob> | null
  return Boolean(b && b.v === 1 && b.sport === sport && b.players && typeof b.players === 'object')
}

/*
 * A per-process memo. The blob is up to ~1 MB for MLB and changes once a night; a waiver screen
 * reloads on every claim, so reading it from Postgres per request would be the slow part of the page.
 */
const MEMO_MS = 5 * 60 * 1000
const memo = new Map<string, { at: number; blob: DailySportFormBlob | null }>()

export function clearDailySportFormMemo(): void {
  memo.clear()
}

/**
 * Last season's stored form blob (the season before `season`), for the prior-season blend. Null when
 * none is stored — `player_game_stats` has no rows for that season — and the caller then prices from
 * this season alone.
 */
export async function readPriorDailySportForm(
  db: Pick<PrismaClient, 'sportsDataCache'>,
  sport: string,
  season: number,
  now: Date = new Date(),
): Promise<DailySportFormBlob | null> {
  const s = sport.toUpperCase()
  if (!isDailyFormSport(s) || !Number.isInteger(season)) return null
  const prior = season - 1
  const memoKey = `${s}:${prior}`
  const held = memo.get(memoKey)
  if (held && now.getTime() - held.at < MEMO_MS) return held.blob
  let blob: DailySportFormBlob | null = null
  try {
    const row = await db.sportsDataCache.findUnique({ where: { cacheKey: dailyFormKey(s, prior) } })
    if (row && row.expiresAt > now && isBlob(row.data, s) && row.data.season === prior) blob = row.data
  } catch {
    blob = null
  }
  memo.set(memoKey, { at: now.getTime(), blob })
  return blob
}

/** The newest stored form blob for a sport, or null when none is stored or it has expired. */
export async function readDailySportForm(
  db: Pick<PrismaClient, 'sportsDataCache'>,
  sport: string,
  now: Date = new Date(),
): Promise<DailySportFormBlob | null> {
  const s = sport.toUpperCase()
  if (!isDailyFormSport(s)) return null
  const held = memo.get(s)
  if (held && now.getTime() - held.at < MEMO_MS) return held.blob

  let blob: DailySportFormBlob | null = null
  try {
    const pointer = await db.sportsDataCache.findUnique({ where: { cacheKey: dailyFormPointerKey(s) } })
    const season = Number((pointer?.data as { season?: unknown } | null)?.season)
    if (pointer && pointer.expiresAt > now && Number.isInteger(season)) {
      const row = await db.sportsDataCache.findUnique({ where: { cacheKey: dailyFormKey(s, season) } })
      if (row && row.expiresAt > now && isBlob(row.data, s)) blob = row.data
    }
  } catch {
    blob = null
  }
  memo.set(s, { at: now.getTime(), blob })
  return blob
}
