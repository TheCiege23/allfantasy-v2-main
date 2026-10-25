import 'server-only'

import type { PrismaClient } from '@prisma/client'

import { getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
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
 * cannot drift apart by more than one run. READER: `readDailySportForm`, for request paths. Neither
 * calls a provider.
 */

type Db = Pick<PrismaClient, 'playerGameStat' | 'playerIdentityMap' | 'sportsDataCache'>

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

  const ids = [...new Set(rows.map((r) => r.playerId))]
  const identityPositions = new Map<string, string | null>()
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const found = await db.playerIdentityMap.findMany({
      where: { sport: s, id: { in: ids.slice(i, i + ID_BATCH) } },
      select: { id: true, position: true },
    })
    for (const f of found) identityPositions.set(f.id, f.position ?? null)
  }

  const blob = buildDailySportForm({ sport: s, season, rows, identityPositions, normalizer, computedAt: now })
  const players = Object.keys(blob.players).length
  if (players === 0) return { sport: s, season, rowsRead: rows.length, players: 0, written: false, reason: 'no_regular_season_games' }
  if (opts.dryRun) return { sport: s, season, rowsRead: rows.length, players, written: false, reason: 'dry_run' }

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
  return { sport: s, season, rowsRead: rows.length, players, written: true }
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
