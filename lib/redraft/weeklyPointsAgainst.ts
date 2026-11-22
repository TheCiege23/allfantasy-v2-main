/**
 * Points Against as a per-week average.
 *
 * In a league that plays several games a week a team faces several opponents in one week, each with
 * a weekly score of their own. Points For counts the team's own weekly score once, so adding every
 * opponent's score made Points Against read about five times Points For in a five-games league.
 * Each week now contributes the AVERAGE of that week's opponents, which puts the two columns on the
 * same scale (owner's call, 2026-11-19). A week with one game contributes that one opponent's score,
 * so a league that plays one game a week is unchanged.
 *
 * Pure: the standings tallies feed it one game at a time and read the totals at the end.
 */
export function createWeeklyPointsAgainst() {
  const weeks = new Map<string, { teamId: string; sum: number; games: number }>()
  return {
    /** One game: `opponentScore` was scored against `teamId` in `week`. */
    add(teamId: string, week: number, opponentScore: number): void {
      const key = `${teamId}:${week}`
      const entry = weeks.get(key)
      if (entry) {
        entry.sum += opponentScore
        entry.games += 1
      } else {
        weeks.set(key, { teamId, sum: opponentScore, games: 1 })
      }
    },
    /** Each team's season total: the sum, over its weeks, of that week's average opponent score. */
    totals(): Map<string, number> {
      const out = new Map<string, number>()
      for (const { teamId, sum, games } of weeks.values()) out.set(teamId, (out.get(teamId) ?? 0) + sum / games)
      return out
    },
  }
}
