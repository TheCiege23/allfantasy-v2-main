/**
 * Which weeks of CollegeFootballData `/games/players` a stat sync actually has to ask for.
 *
 * 🛑 THE STAT SYNC ASKED FOR ALL 15 WEEKS, EVERY 6 HOURS, ALL SEASON: 16 calls a run, about 1,900 a
 * month, from this one job. CFBD has a monthly call quota; on 2026-11-10 it ran out, and college
 * football stats, devy pools and college rosters all stopped until the month turned.
 *
 * Most of those calls could not return anything new:
 *   - a week that has not kicked off has no player lines;
 *   - a week that has SETTLED and been written does not change again. Its only remaining use was to
 *     count how many games each player appeared in, which is the same answer every time.
 *
 * So a settled week's appearances are kept once (`SportsDataCache`), a week that has not started is
 * skipped, and only weeks still in play are fetched: usually one or two calls a run instead of 15.
 *
 * PURE. The reads and writes are in `cfbdPlayerStats.ts`.
 */

/** playerId -> the ids of the games he appeared in that week. */
export type WeekAppearances = Record<string, string[]>

export const weekAppearancesKey = (season: number, week: number) => `cfbd:games-players:appearances:${season}:${week}`

export type WeekFetchDecision = 'cached' | 'not_started' | 'fetch'

/**
 * `isComplete`: the week has settled and its game logs were written after that (planCfbdGameLogs).
 * `hasStarted`: a game of the week has kicked off; true when the schedule cannot say.
 * A settled week with nothing kept yet is fetched once more, so the first run fills the store.
 */
export function decideWeekFetch(args: { isComplete: boolean; hasStarted: boolean; cached: boolean }): WeekFetchDecision {
  if (args.isComplete && args.cached) return 'cached'
  if (!args.hasStarted) return 'not_started'
  return 'fetch'
}

/** One week's `/games/players` payload as appearances. Tolerates any malformed level. */
export function appearancesOfWeek(games: unknown): WeekAppearances {
  const sets = new Map<string, Set<string>>()
  if (!Array.isArray(games)) return {}
  for (const game of games as Record<string, unknown>[]) {
    const gameId = String(game?.id ?? '')
    if (!gameId) continue
    for (const team of (game.teams ?? []) as Record<string, unknown>[]) {
      for (const category of (team?.categories ?? []) as Record<string, unknown>[]) {
        for (const type of (category?.types ?? []) as Record<string, unknown>[]) {
          for (const athlete of (type?.athletes ?? []) as Record<string, unknown>[]) {
            const id = athlete?.id == null ? null : String(athlete.id)
            if (!id) continue
            let set = sets.get(id)
            if (!set) sets.set(id, (set = new Set<string>()))
            set.add(gameId)
          }
        }
      }
    }
  }
  const out: WeekAppearances = {}
  for (const [id, set] of sets) out[id] = [...set]
  return out
}

/** Games played per player across weeks: distinct game ids, so a game seen twice counts once. */
export function gamesPlayedFrom(weeks: Iterable<WeekAppearances>): Map<string, number> {
  const sets = new Map<string, Set<string>>()
  for (const week of weeks) {
    for (const [id, gameIds] of Object.entries(week)) {
      let set = sets.get(id)
      if (!set) sets.set(id, (set = new Set<string>()))
      for (const g of gameIds) set.add(g)
    }
  }
  return new Map([...sets].map(([id, set]) => [id, set.size]))
}

/** A kept week is only usable when it is the shape we wrote. */
export function readWeekAppearances(data: unknown): WeekAppearances | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const out: WeekAppearances = {}
  for (const [id, v] of Object.entries(data as Record<string, unknown>)) {
    if (!Array.isArray(v)) return null
    out[id] = v.map(String)
  }
  return out
}

/** School participation totals include games in which no individual stat was recorded. */
export function verifiedSeasonAppearances(weeks: Map<number, WeekAppearances>, receipts: unknown, maxWeek: number) {
  const counts = gamesPlayedFrom(weeks.values())
  if (!Array.isArray(receipts)) return counts
  for (const receipt of receipts) {
    const { playerId, throughWeek, gamesPlayed, sourceUrl } = receipt ?? {}
    if (typeof playerId !== 'string' || !/^\d+$/.test(playerId) || typeof sourceUrl !== 'string' ||
      !sourceUrl.startsWith('https://') || !Number.isInteger(throughWeek) || throughWeek < 1 ||
      throughWeek > maxWeek || !Number.isInteger(gamesPlayed) || gamesPlayed < 1 || gamesPlayed > throughWeek + 1) continue
    const earlier = new Set<string>(), later = new Set<string>()
    for (const [week, players] of weeks) {
      for (const id of players[playerId] ?? []) (week <= throughWeek ? earlier : later).add(id)
    }
    for (const id of earlier) later.delete(id)
    counts.set(playerId, Math.max(counts.get(playerId) ?? 0, gamesPlayed + later.size))
  }
  return counts
}
