/**
 * Adapter from `/api/player-card-analytics` payload → typed season rows
 * for the GameLog tab. Kept in a no-JSX module so it is unit-testable
 * without the JSX vitest pipeline.
 *
 * Server contract is `seasonHistory: PlayerCardSeasonStat[] | null` from
 * lib/player-card-analytics/types.ts. Older clients read `seasonStats`,
 * which silently falls into the empty state — accept either key.
 */
export type GameLogSeasonRow = {
  season: string
  gamesPlayed: number | null
  fantasyPoints: number | null
  fantasyPointsPerGame: number | null
  team: string | null
  stats: Record<string, unknown>
}

export function toSeasonRows(payload: unknown): GameLogSeasonRow[] {
  if (!payload || typeof payload !== 'object') return []
  const obj = payload as Record<string, unknown>
  const raw =
    (Array.isArray(obj.seasonHistory) && obj.seasonHistory) ||
    (Array.isArray(obj.seasonStats) && obj.seasonStats) ||
    null
  if (!raw) return []
  return raw
    .map((r) => {
      if (!r || typeof r !== 'object') return null
      const o = r as Record<string, unknown>
      const season = o.season != null ? String(o.season) : null
      if (!season) return null
      return {
        season,
        gamesPlayed: typeof o.gamesPlayed === 'number' ? o.gamesPlayed : null,
        fantasyPoints: typeof o.fantasyPoints === 'number' ? o.fantasyPoints : null,
        fantasyPointsPerGame:
          typeof o.fantasyPointsPerGame === 'number' ? o.fantasyPointsPerGame : null,
        team: typeof o.team === 'string' ? o.team : null,
        stats:
          o.stats && typeof o.stats === 'object'
            ? (o.stats as Record<string, unknown>)
            : {},
      } satisfies GameLogSeasonRow
    })
    .filter((r): r is GameLogSeasonRow => r != null)
    .sort((a, b) => b.season.localeCompare(a.season))
}

export function pickStatNum(
  stats: Record<string, unknown>,
  ...keys: string[]
): number | null {
  for (const k of keys) {
    const v = stats[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}
