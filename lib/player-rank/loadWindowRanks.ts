import 'server-only'

import { prisma } from '@/lib/prisma'
import { getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { resolveStoredSeasonType } from '@/lib/sports-data/riSeasonType'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { computeWindowRanks, type DayPoints, type WindowRankTable } from './windowRanks'

/**
 * The window rank table for a sport, a scoring and an Eastern day — read from Postgres only.
 *
 * Source: `player_game_stats` (every stored box line this season), scored with the SAME scorer and
 * normalizer the weekly matchup engine and the game log use, so a player's points here equal the
 * sum of his game-log FPts. Preseason lines are left out, as in the game log.
 *
 * ⚠ CACHED PER (sport, season, scoring, day) IN `sportsDataCache`, read-through. Ranking needs every
 * player's season, which is tens of thousands of lines; one build per league per day serves every
 * card opened that day. A cold cache costs one build on the request that finds it — the accepted
 * read-through shape (CLAUDE.md, DB-first), with no provider call anywhere on this path. The key
 * carries the day, so yesterday's table is never served as today's; it expires after two days.
 */

const KEY_PREFIX = 'player-window-ranks:v1:'
const PAGE = 5000

export function windowRanksCacheKey(sport: string, season: number, scoringKey: string, today: string): string {
  return `${KEY_PREFIX}${sport}:${season}:${scoringKey}:${today}`
}

export function easternToday(now: Date = new Date()): string {
  return easternCalendarDay(now)!.toISOString().slice(0, 10)
}

function isTable(v: unknown): v is WindowRankTable {
  return !!v && typeof v === 'object' && typeof (v as WindowRankTable).asOf === 'string' && !!(v as WindowRankTable).windows
}

/** The newest season with stored box lines for the sport, or null when there are none. */
export async function latestStatSeason(sport: string): Promise<number | null> {
  const row = await prisma.playerGameStat.findFirst({ where: { sportType: sport }, orderBy: { season: 'desc' }, select: { season: true } })
  return row?.season ?? null
}

export async function loadWindowRanks(args: {
  sport: string
  season: number
  scoringKey: string
  scorer: (stats: Record<string, number>, position?: string | null) => number
  now?: Date
}): Promise<WindowRankTable | null> {
  const { sport, season } = args
  const normalize = getDailySportNormalizer(sport)
  if (!normalize) return null
  const today = easternToday(args.now)
  const cacheKey = windowRanksCacheKey(sport, season, args.scoringKey, today)

  const hit = await prisma.sportsDataCache.findUnique({ where: { cacheKey }, select: { data: true } }).catch(() => null)
  if (hit && isTable(hit.data)) return hit.data

  // Every box line this season, paged by id so a full season never sits in one query.
  const lines: Array<{ playerId: string; gameDate: Date | null; season: number; normalizedStatMap: unknown }> = []
  let cursor: string | undefined
  for (;;) {
    const page = await prisma.playerGameStat.findMany({
      where: { sportType: sport, season },
      select: { id: true, playerId: true, gameDate: true, season: true, normalizedStatMap: true },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
    for (const r of page) lines.push(r)
    if (page.length < PAGE) break
    cursor = page[page.length - 1].id
  }

  const ids = [...new Set(lines.map((l) => l.playerId))]
  const positions = new Map<string, string | null>()
  for (let i = 0; i < ids.length; i += PAGE) {
    const rows = await prisma.playerIdentityMap.findMany({ where: { id: { in: ids.slice(i, i + PAGE) } }, select: { id: true, position: true } })
    for (const r of rows) positions.set(r.id, r.position)
  }

  // Sum per player per Eastern day; a game's box groups (and a double-header) are one day's points.
  const byDay = new Map<string, DayPoints>()
  for (const l of lines) {
    if (!l.gameDate) continue
    if (resolveStoredSeasonType({ normalizedStatMap: l.normalizedStatMap, sport, season: l.season, gameDate: l.gameDate }) === 'pre') continue
    const stats = normalize(l.normalizedStatMap).stats
    if (Object.keys(stats).length === 0) continue
    const pts = args.scorer(stats, positions.get(l.playerId) ?? null)
    if (!Number.isFinite(pts)) continue
    const day = l.gameDate.toISOString().slice(0, 10)
    const k = `${l.playerId}|${day}`
    const cur = byDay.get(k) ?? { playerId: l.playerId, day, points: 0, games: 0 }
    cur.points += pts
    cur.games = 1 // one game day; box groups of the same game do not count twice
    byDay.set(k, cur)
  }

  const table = computeWindowRanks({ sport, today, days: [...byDay.values()], positions })
  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey },
      create: { cacheKey, data: table as never, expiresAt: new Date(Date.now() + 2 * 86_400_000) },
      update: { data: table as never, expiresAt: new Date(Date.now() + 2 * 86_400_000) },
    })
    .catch(() => {})
  return table
}
