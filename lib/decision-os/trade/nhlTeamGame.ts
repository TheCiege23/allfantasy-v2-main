/**
 * Puts an NHL projection board's GOALIES on the team-game scale before anything is compared. PURE.
 *
 * Hockey projection rates are per game the player PLAYED (`perGameRates`). For a skater that is what the
 * grade wants — like a basketball player, a healthy season is valued and a skater who missed time is not
 * projected to miss it again. A goalie is different in kind, the same way a baseball starter is
 * (`./mlbTeamGame.ts`): playing time is his ROLE. A starter plays about 60 of 82, a backup about 25, and
 * the board multiplies a per-game value by the team's games left — so before 2026-11-16 a backup with a
 * good save line was valued as if he started every night, about three times what he is worth.
 *
 * So each goalie's line is scaled to his share of team games: the games behind his projection over the
 * team games in that season, read off the board (the most games any skater played). A projection that
 * BLENDS two seasons (`af-projections/seasonBlend.ts`) counts each season against its own team games and
 * weights the two shares as the line is weighted — never pooled, which would let a blended veteran's two
 * seasons set one season's team games.
 */

/** The NHL regular season, for a season the board cannot read team games from. */
export const NHL_REGULAR_SEASON_GAMES = 82

type NhlLine = {
  id: string
  position: string
  sampleGames: number | null
  sourceSeason?: number | null
  seasonBlend?: { currentGames: number; previousGames: number; currentWeight: number } | null
  stats: Record<string, number>
}

type NhlTeamGameLine<T extends NhlLine> = T & {
  /** Share of team games this line counts for: 1 for a skater, games played ÷ team games for a goalie. */
  share: number
}

export function isGoalie(position: string | null | undefined): boolean {
  return String(position ?? '').trim().toUpperCase() === 'G'
}

/**
 * Every line on the team-game scale. A goalie whose games are unknown has no share — scaling him by a
 * guess would be off by as much as the error this exists to prevent — so he is dropped, not guessed.
 */
export function toNhlTeamGameLines<T extends NhlLine>(lines: readonly T[]): Array<NhlTeamGameLine<T>> {
  const teamGames = new Map<number | null, number>()
  const seen = (key: number | null, games: number) => teamGames.set(key, Math.max(teamGames.get(key) ?? 0, games))
  for (const l of lines) {
    if (isGoalie(l.position)) continue
    if (l.seasonBlend) {
      const season = l.sourceSeason ?? null
      seen(season, l.seasonBlend.currentGames)
      if (season != null) seen(season - 1, l.seasonBlend.previousGames)
      continue
    }
    if (l.sampleGames != null) seen(l.sourceSeason ?? null, l.sampleGames)
  }

  const out: Array<NhlTeamGameLine<T>> = []
  for (const l of lines) {
    if (!isGoalie(l.position)) {
      out.push({ ...l, share: 1 })
      continue
    }
    if (l.sampleGames == null || l.sampleGames <= 0) continue
    const season = teamGames.get(l.sourceSeason ?? null) ?? NHL_REGULAR_SEASON_GAMES
    const prevSeason = teamGames.get(l.sourceSeason != null ? l.sourceSeason - 1 : null) ?? NHL_REGULAR_SEASON_GAMES
    if (season <= 0) continue
    const b = l.seasonBlend
    const share = b
      ? Math.min(1, b.currentWeight * Math.min(1, b.currentGames / season) + (1 - b.currentWeight) * Math.min(1, b.previousGames / prevSeason))
      : Math.min(1, l.sampleGames / season)
    const stats: Record<string, number> = {}
    for (const [k, v] of Object.entries(l.stats)) stats[k] = v * share
    out.push({ ...l, stats, share })
  }
  return out
}
