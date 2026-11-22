/**
 * The `LeagueTrade` filter for "trades in any of these leagues", as ONE relation join per platform.
 *
 * 🛑 ONE `{ platform, history: { sleeperLeagueId } }` BRANCH PER LEAGUE COST 5.3 SECONDS. Prisma
 * writes a separate `LEFT JOIN "LeagueTradeHistory"` for every relation filter in an `OR`, so the
 * owner's 104-league account sent a query with 104 joins of the same table. Measured on production
 * 2026-11-22 with `EXPLAIN (ANALYZE, SUMMARY)`: 3,792 ms to PLAN it and 1,500 ms to run it. The same
 * rows through one join and an `= ANY(...)` list: 0.8 ms to plan, 31 ms to run. It was the whole of
 * the home trades card's "ledger" step (4.9–5.5s), and the 14-day trade-version poll paid it too.
 * pg_stat_statements never showed it, because planning time is not tracked there.
 *
 * Grouping by platform keeps the predicate identical — "(platform = p AND league = x) for some
 * pair" is "platform = p AND league IN (every x paired with p)" — and a one-platform account (the
 * common case) gets exactly one join.
 */
export type LeagueTradeSource = { platform?: string | null; platformLeagueId?: string | null }

export type LeagueTradeSourceBranch = {
  platform: string
  history: { sleeperLeagueId: { in: string[] } }
}

/** `[]` when no league has a provider id: callers must skip the query rather than send `OR: []`. */
export function leagueTradeSourceBranches(leagues: readonly LeagueTradeSource[]): LeagueTradeSourceBranch[] {
  const byPlatform = new Map<string, Set<string>>()
  for (const league of leagues) {
    if (!league.platformLeagueId) continue
    const platform = String(league.platform ?? 'sleeper').toLowerCase()
    const ids = byPlatform.get(platform) ?? new Set<string>()
    ids.add(league.platformLeagueId)
    byPlatform.set(platform, ids)
  }
  return [...byPlatform.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([platform, ids]) => ({ platform, history: { sleeperLeagueId: { in: [...ids].sort() } } }))
}
