import { riFetchRows } from '@/lib/workers/providers/rollingInsightsRest'
import { classifyRiSeasonType, type RiSeasonType } from '@/lib/sports-data/riSeasonType'
import { easternCalendarDay, gameDayFromRiGameId } from '@/lib/sports-data/easternGameDay'

/**
 * A COMPLETE season schedule for the sports whose other feeds are not, from Rolling Insights
 * `/schedule-season/{startYear}/{SPORT}` — for the week finalizer, and nothing else.
 *
 * WHY. The finalizer seals a fantasy week once every SCHEDULED game is final. For NCAAB the
 * schedules in `SportsGame` are incomplete (measured on production 2026-09-24):
 *   - thesportsdb 2025-26: exactly 3,000 games, stopping 2026-02-04 — a fetch cap;
 *   - week 1 of 2025-26: 243 scheduled games against 310 in our own game logs;
 *   - espn_live 2026-27: only the 56 opening-day games, filed under season 2027.
 * On that feed a week can seal while games it never saw still lack stats — wrong results,
 * published. RI's season schedule for 2025-26 (`fixtures/schedule-season.NCAABB.json`) holds
 * 6,027 games and matches our logs exactly: every final/completed game has lines, and no logged
 * game is missing from it.
 *
 * ⚠ WHY NOT `SportsGame`. That table has ~39 readers and most do not filter by source; a feed
 * ranked last still wins a slice where it is the only fresh one. This endpoint carries NO SCORES
 * (import-scores/route.ts records the NFL incident where exactly that rendered "- @ -"), so its
 * rows must not be able to reach a scoreboard. They live in `SportsDataCache` under a prefix only
 * the finalizer reads, one key per US Eastern game day plus a per-season marker. The prefix is not
 * in the cache purge's allow-list, so nothing deletes it.
 *
 * ⚠ A 304 / error / unsupported WRITES NOTHING (CLAUDE.md's 304 rule): 2026-27 NCAABB returned
 * 304 twice on 2026-09-24 — most likely not yet published — and an emptiness written then would
 * read as "no games scheduled".
 */

export type ScheduleGame = {
  gameId: string
  /** US Eastern day, `YYYY-MM-DD` — the same bucketing `player_game_stats.game_date` uses. */
  day: string
  startTime: string | null
  /** The vendor status verbatim (`final`, `completed`, `replaced`, `postponed`, …). */
  status: string | null
  seasonType: RiSeasonType | null
  eventName: string | null
  replacedBy: string | null
}

const str = (v: unknown): string | null => {
  if (v == null) return null
  const t = String(v).trim()
  return t && t.toLowerCase() !== 'null' ? t : null
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

export function parseRiScheduleSeason(rows: unknown[]): ScheduleGame[] {
  const out: ScheduleGame[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const g = row as Record<string, unknown>
    const gameId = str(g.game_ID ?? g.game_id)
    if (!gameId) continue
    const time = str(g.game_time)
    const parsed = time ? new Date(time) : null
    const instant = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null
    const day = gameDayFromRiGameId(gameId) ?? easternCalendarDay(instant)
    if (!day) continue
    out.push({
      gameId,
      day: isoDay(day),
      startTime: instant ? instant.toISOString() : null,
      status: str(g.status),
      seasonType: classifyRiSeasonType(g.season_type),
      eventName: str(g.event_name),
      replacedBy: str(g.replaced_by),
    })
  }
  return out
}

export function scheduleKeyPrefix(sport: string, season: number): string {
  return `${sport.toUpperCase()}:rischedule:${season}:`
}

type CacheDb = {
  sportsDataCache: {
    upsert(args: unknown): Promise<unknown>
    deleteMany(args: unknown): Promise<{ count: number }>
    findMany(args: unknown): Promise<Array<{ cacheKey: string; data: unknown }>>
    findUnique(args: unknown): Promise<{ data: unknown } | null>
  }
}

export type ScheduleSyncResult = {
  sport: string
  season: number
  fetched: boolean
  notModified: boolean
  unsupported: boolean
  error: string | null
  games: number
  days: number
  staleDaysRemoved: number
  statusCounts: Record<string, number>
}

/** A far expiry: `expiresAt` is required, and nothing may treat this schedule as disposable. */
const KEEP_MS = 400 * 86_400_000

export async function syncRiSeasonSchedule(opts: {
  sport: string
  season: number
  db: CacheDb
  now?: Date
  fetchImpl?: typeof fetch
}): Promise<ScheduleSyncResult> {
  const sport = opts.sport.toUpperCase()
  const now = opts.now ?? new Date()
  const result: ScheduleSyncResult = {
    sport, season: opts.season, fetched: false, notModified: false, unsupported: false,
    error: null, games: 0, days: 0, staleDaysRemoved: 0, statusCounts: {},
  }

  const { rows, notModified, unsupported, error } = await riFetchRows('schedule_season', {
    sport,
    season: opts.season,
    fetchImpl: opts.fetchImpl,
  })
  if (notModified || unsupported || error) {
    result.notModified = notModified
    result.unsupported = unsupported
    result.error = error
    return result // never write an emptiness
  }
  const games = parseRiScheduleSeason(rows)
  if (games.length === 0) {
    result.error = 'schedule-season returned 200 with no parseable games — refusing to replace a stored schedule with nothing'
    return result
  }
  result.fetched = true
  result.games = games.length

  const byDay = new Map<string, ScheduleGame[]>()
  for (const g of games) {
    byDay.set(g.day, [...(byDay.get(g.day) ?? []), g])
    const k = g.status ?? '(none)'
    result.statusCounts[k] = (result.statusCounts[k] ?? 0) + 1
  }
  result.days = byDay.size

  const prefix = scheduleKeyPrefix(sport, opts.season)
  const expiresAt = new Date(now.getTime() + KEEP_MS)
  const put = (cacheKey: string, data: unknown) =>
    opts.db.sportsDataCache.upsert({
      where: { cacheKey },
      create: { cacheKey, data, expiresAt },
      update: { data, expiresAt },
    })

  for (const [day, list] of byDay) await put(`${prefix}${day}`, { games: list })

  // A day that held games before and holds none now (a rescheduled slate) must not linger.
  const keep = [...byDay.keys()].map((d) => `${prefix}${d}`)
  const removed = await opts.db.sportsDataCache.deleteMany({
    where: { cacheKey: { startsWith: prefix, notIn: [...keep, `${prefix}meta`] } },
  })
  result.staleDaysRemoved = removed.count

  const daysSorted = [...byDay.keys()].sort()
  await put(`${prefix}meta`, {
    syncedAt: now.toISOString(),
    games: games.length,
    firstDay: daysSorted[0],
    lastDay: daysSorted[daysSorted.length - 1],
    statusCounts: result.statusCounts,
  })
  return result
}

/**
 * The stored schedule for Eastern days in `[start, end)`, or `null` when no schedule has been
 * synced for the season at all — which the finalizer must treat as "cannot tell", never "empty".
 */
export async function readRiScheduleWindow(
  db: CacheDb,
  args: { sport: string; season: number; window: { start: Date; end: Date } },
): Promise<ScheduleGame[] | null> {
  const prefix = scheduleKeyPrefix(args.sport, args.season)
  const meta = await db.sportsDataCache.findUnique({ where: { cacheKey: `${prefix}meta` } })
  if (!meta) return null
  const keys: string[] = []
  for (let t = args.window.start.getTime(); t < args.window.end.getTime(); t += 86_400_000) {
    keys.push(`${prefix}${isoDay(new Date(t))}`)
  }
  const rows = await db.sportsDataCache.findMany({ where: { cacheKey: { in: keys } }, select: { cacheKey: true, data: true } })
  return rows.flatMap((r) => {
    const games = (r.data as { games?: ScheduleGame[] } | null)?.games
    return Array.isArray(games) ? games : []
  })
}

/** The season a sport's schedule sync should fetch now: the year the CURRENT season started. */
export function currentScheduleSeason(now: Date = new Date()): number {
  // College basketball and the winter sports start in the autumn; before August it is last season.
  return now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
}
