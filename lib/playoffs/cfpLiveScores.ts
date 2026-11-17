import type { PlayoffSeriesView } from "./types"

export type CfpLiveScore = { home: string; away: string; homeScore: number; awayScore: number; startsAt: string; fetchedAt: string }
const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase()

/** Only an unambiguous, current provider event with both actual teams may decorate a card. */
export function matchCfpLiveScore(game: PlayoffSeriesView, rows: CfpLiveScore[], now = Date.now()): CfpLiveScore | null {
  const start = Date.parse(game.startsAt ?? "")
  if (!Number.isFinite(start) || !game.homeTeamName || !game.awayTeamName) return null
  const matches = rows.filter((row) => {
    const fetched = Date.parse(row.fetchedAt), at = Date.parse(row.startsAt)
    return Number.isFinite(fetched) && fetched <= now && now - fetched <= 5 * 60_000 &&
      Number.isFinite(at) && Math.abs(at - start) <= 2 * 60 * 60_000 && at <= now &&
      Number.isInteger(row.homeScore) && row.homeScore >= 0 && Number.isInteger(row.awayScore) && row.awayScore >= 0 &&
      key(row.home) !== key(row.away) &&
      ((key(row.home) === key(game.homeTeamName) && key(row.away) === key(game.awayTeamName)) ||
       (key(row.away) === key(game.homeTeamName) && key(row.home) === key(game.awayTeamName)))
  })
  return matches.length === 1 ? matches[0] : null
}
