import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { createTtlMemo } from '@/lib/ttl-memo'

/**
 * College basketball box scores, averaged per player and season — the one read behind the draft
 * pool's stat line (`lib/draft-room/ncaabDraftSeason.ts`) and the player pool's "still playing"
 * rule (`ncaabPlayerPoolRules.ts`). Kept free of scoring imports so the pool resolver can use it.
 *
 * Joined by Rolling Insights id only (`provider_player_id`) — never by name.
 */

const SPORT = 'NCAAB'
const SOURCE = 'rolling_insights_live'

/** Box-score keys averaged per game. The same list `af-projections/ncaabGameRates.ts` reads. */
const BOX_STATS = [
  'points', 'assists', 'blocks', 'steals', 'fouls', 'turnovers', 'minutes',
  'total_rebounds', 'defensive_rebounds', 'offensive_rebounds', 'field_goals_made', 'field_goals_attempted',
  'free_throws_made', 'free_throws_attempted', 'two_points_made', 'two_points_attempted',
  'three_points_made', 'three_points_attempted',
] as const

export type NcaabSeasonBox = {
  /** The season's starting year: 2026 is 2026–27. */
  season: number
  /** Games the player logged minutes in. */
  games: number
  /** Per-game averages over those games, keyed by box-score stat. */
  rates: Record<string, number>
}

export type NcaabSeasonBoxes = {
  /** The newest season the store holds a college box score for, or null when it holds none. */
  season: number | null
  /** Rolling Insights player id → that player's newest-season and previous-season lines. */
  byRiId: Map<string, { current?: NcaabSeasonBox; previous?: NcaabSeasonBox }>
}

type BoxRow = { id: string; season: number; games: number; rates: Record<string, number> | null }

/**
 * Rows from the aggregate → the two-season index. Pure, so the season choice is testable without a
 * database. `newestSeason` is the newest season the STORE holds; without it the newest season among
 * the rows stands in. They differ on a season's first days, when its games exist but none has
 * finished — and then last season must not be mistaken for this one.
 */
export function indexNcaabSeasonBoxes(rows: readonly BoxRow[], newestSeason?: number | null): NcaabSeasonBoxes {
  let season: number | null = newestSeason ?? null
  if (season == null) for (const row of rows) if (Number.isInteger(row.season) && (season == null || row.season > season)) season = row.season
  const byRiId: NcaabSeasonBoxes['byRiId'] = new Map()
  if (season == null) return { season, byRiId }
  for (const row of rows) {
    const id = String(row.id ?? '').trim()
    if (!id || !row.rates || !(row.games > 0)) continue
    const slot = row.season === season ? 'current' : row.season === season - 1 ? 'previous' : null
    if (!slot) continue
    const entry = byRiId.get(id) ?? {}
    entry[slot] = { season: row.season, games: row.games, rates: row.rates }
    byRiId.set(id, entry)
  }
  return { season, byRiId }
}

/**
 * One aggregate for the newest two seasons, averaged in Postgres: a row per player and season
 * crosses the wire, not 130,000 box scores. Regular-season games the player logged minutes in,
 * finished (a game from an earlier day, or one marked final today).
 */
async function readNcaabSeasonBoxes(now: Date): Promise<NcaabSeasonBoxes> {
  const newest = await prisma.$queryRaw<Array<{ season: number | null }>>(Prisma.sql`
    SELECT max(season)::int AS season FROM player_game_stats WHERE "sportType" = ${SPORT} AND source = ${SOURCE}`)
  const season = newest[0]?.season ?? null
  if (season == null) return { season: null, byRiId: new Map() }
  const today = now.toISOString().slice(0, 10)
  const fields = BOX_STATS.map((key) => Prisma.sql`${key}::text, AVG(CASE WHEN jsonb_typeof(box -> ${key}::text) = 'number'
    THEN (box ->> ${key}::text)::double precision ELSE 0 END)`)
  const rows = await prisma.$queryRaw<BoxRow[]>(Prisma.sql`
    SELECT provider_player_id AS id, season::int AS season, count(*)::int AS games, jsonb_build_object(${Prisma.join(fields)}) AS rates
    FROM player_game_stats
    CROSS JOIN LATERAL (SELECT normalized_stat_map -> 'stats' AS box) b
    WHERE "sportType" = ${SPORT} AND source = ${SOURCE} AND season IN (${season}, ${season - 1})
      AND provider_player_id IS NOT NULL
      AND normalized_stat_map ->> 'seasonType' = 'regular'
      AND jsonb_typeof(box -> 'minutes') = 'number' AND (box -> 'minutes') > '0'::jsonb
      AND (game_date < ${today}::date OR normalized_stat_map ->> 'gameFinal' = 'true')
    GROUP BY provider_player_id, season`)
  return indexNcaabSeasonBoxes(rows, season)
}

/**
 * Shared by the draft pool build and the player-pool filter, which run back to back. A failed read
 * is not cached; an empty one is (off-season is a real answer, and the next window asks again).
 */
const boxesMemo = createTtlMemo<NcaabSeasonBoxes>({ ttlMs: 5 * 60_000, maxEntries: 2 })

export async function loadNcaabSeasonBoxes(now: Date = new Date()): Promise<NcaabSeasonBoxes> {
  const key = now.toISOString().slice(0, 10)
  const cached = boxesMemo.get(key)
  if (cached) return cached
  const boxes = await readNcaabSeasonBoxes(now)
  boxesMemo.set(key, boxes)
  return boxes
}
