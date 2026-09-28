import type { RiSeasonType } from '@/lib/sports-data/riSeasonType'

/**
 * The READ half of the Rolling Insights season schedule (riSeasonSchedule.ts) — the stored shape and
 * the cache reader, with no provider client.
 *
 * 🛑 SPLIT OUT BECAUSE THE LINEUP LOCK IS IN CLIENT BUNDLES. `lineupLock.ts` is reached from client
 * components (via `teamDefenseIdentity.ts` -> the league Team tab), and `riSeasonSchedule.ts` imports
 * `rollingInsightsRest.ts`, which is `server-only`. Importing the reader from there broke `next build`.
 * The reader only needs a db handle, so it lives here; `riSeasonSchedule.ts` re-exports it for the
 * finalizer and the sync. Import this leaf, never the sync module, from anything a client can reach.
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
  /**
   * The teams, in Rolling Insights' own formal naming ("Winthrop University") — the same naming the
   * NCAAB player pool carries, which is what lets the lineup lock match a player to his game. Absent
   * on rows synced before they were kept; a reader must treat that as "unknown", never as "no game".
   */
  homeTeam?: string | null
  awayTeam?: string | null
  homeTeamId?: string | null
  awayTeamId?: string | null
}

export type ScheduleCacheDb = {
  sportsDataCache: {
    upsert(args: unknown): Promise<unknown>
    deleteMany(args: unknown): Promise<{ count: number }>
    findMany(args: unknown): Promise<Array<{ cacheKey: string; data: unknown }>>
    findUnique(args: unknown): Promise<{ data: unknown } | null>
  }
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10)

export function scheduleKeyPrefix(sport: string, season: number): string {
  return `${sport.toUpperCase()}:rischedule:${season}:`
}

/**
 * The stored schedule for Eastern days in `[start, end)`, or `null` when no schedule has been
 * synced for the season at all — which the finalizer must treat as "cannot tell", never "empty".
 */
export async function readRiScheduleWindow(
  db: ScheduleCacheDb,
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
