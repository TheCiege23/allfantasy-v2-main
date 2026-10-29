/**
 * Pure helpers for reading `depth_charts` rows. No prisma, so the projection writer, the
 * cache-only lookup in `lib/depth-charts.ts` and tests can all share one rule.
 */

export type DepthChartRowLike = {
  team: string
  position: string
  players: unknown
  fetchedAt: Date
  expiresAt: Date
}

/**
 * One row per (team, position): an unexpired row beats an expired one, then the most recently
 * fetched wins.
 *
 * ⚠ TWO WRITERS FILL THIS TABLE FOR THE SAME SPORT, keyed apart only by `source`. MLB, NBA and
 * NHL hold `rolling_insights` rows last written 2026-05-01 AND `rolling_insights_rest` rows the
 * weekly cron refreshes, so a plain findMany returns every team/position twice and lets a
 * five-month-old chart answer for a team whose roster has since changed. Picking by freshness
 * rather than by source name keeps working whichever writer is current.
 */
export function selectCurrentDepthRows<T extends DepthChartRowLike>(rows: T[], now: Date = new Date()): T[] {
  const best = new Map<string, T>()
  for (const row of rows) {
    const key = `${row.team}\u0001${row.position}`
    const prev = best.get(key)
    if (!prev || isFresher(row, prev, now)) best.set(key, row)
  }
  return [...best.values()].sort(
    (a, b) => a.team.localeCompare(b.team) || a.position.localeCompare(b.position),
  )
}

function isFresher(a: DepthChartRowLike, b: DepthChartRowLike, now: Date): boolean {
  const aLive = a.expiresAt > now
  const bLive = b.expiresAt > now
  if (aLive !== bLive) return aLive
  return a.fetchedAt > b.fetchedAt
}

/**
 * Player names in depth order from a stored `players` value.
 *
 * ⚠ THE STORED SHAPE DIFFERS BY WRITER. The older `rolling_insights` rows for MLB/NBA/NHL/NCAAB/
 * SOCCER hold plain name strings; the NFL GraphQL writer and the REST writer hold objects
 * `{ id, player, position, rank?, ... }`. Objects are ordered by `rank` when every entry states
 * one, otherwise kept in stored order.
 */
export function depthChartPlayerNames(players: unknown): string[] {
  if (!Array.isArray(players)) return []
  const entries: Array<{ name: string; rank: number | null }> = []
  for (const p of players) {
    if (typeof p === 'string') {
      const name = p.trim()
      if (name) entries.push({ name, rank: null })
      continue
    }
    if (p && typeof p === 'object') {
      const obj = p as Record<string, unknown>
      const name = typeof obj.player === 'string' ? obj.player.trim() : ''
      if (!name) continue
      const rank = typeof obj.rank === 'number' && Number.isFinite(obj.rank) ? obj.rank : null
      entries.push({ name, rank })
    }
  }
  if (entries.length > 1 && entries.every((e) => e.rank != null)) {
    entries.sort((a, b) => (a.rank as number) - (b.rank as number))
  }
  return entries.map((e) => e.name)
}
