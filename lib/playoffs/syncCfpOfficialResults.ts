import "server-only"
import { readSeasonBracketGame, publishSeasonBracketFinal } from "./publishSeasonBracketFinal"

type Mapped = { seriesNumber: number; matchupId: number; startsAt: string }
type ProviderGame = { id?: unknown; startDate?: unknown; completed?: unknown; homeTeam?: { school?: unknown }; awayTeam?: { school?: unknown }; homePoints?: unknown; awayPoints?: unknown }
type Matchup = { id?: unknown; game?: ProviderGame | null }

/** Publish only completed CFP games matching the saved field, game time and both participants. */
export async function syncCfpOfficialResults(input: { season: number; payload: unknown; games: Mapped[] }) {
  const rounds = (input.payload as { rounds?: Array<{ matchups?: Matchup[] }> } | null)?.rounds
  if (!Array.isArray(rounds)) return { published: 0, failures: 1 }
  const matchups = rounds.flatMap(round => Array.isArray(round.matchups) ? round.matchups : [])
  let published = 0, failures = 0
  const normalize = (value: unknown) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : ""
  for (const row of input.games) {
    const matches = matchups.filter(matchup => matchup.id === row.matchupId)
    if (matches.length !== 1) { failures++; continue }
    const game = matches[0].game
    if (!game || game.completed !== true) continue
    const at = typeof game.startDate === "string" ? Date.parse(game.startDate) : NaN
    const scheduledAt = Date.parse(row.startsAt)
    if (!Number.isInteger(game.id) || !Number.isFinite(at) || !Number.isFinite(scheduledAt) || at > Date.now() || Math.abs(at - scheduledAt) > 2 * 60 * 60 * 1000 ||
        !Number.isInteger(game.homePoints) || !Number.isInteger(game.awayPoints) || Number(game.homePoints) < 0 || Number(game.awayPoints) < 0 || Number(game.homePoints) > 300 || Number(game.awayPoints) > 300 || game.homePoints === game.awayPoints) { failures++; continue }
    const matchup = await readSeasonBracketGame({ sport: "ncaaf", season: input.season, seriesNumber: row.seriesNumber })
    if (!matchup.ok) { failures++; continue }
    const home = normalize(game.homeTeam?.school), away = normalize(game.awayTeam?.school)
    const direct = home === normalize(matchup.home) && away === normalize(matchup.away)
    const reversed = home === normalize(matchup.away) && away === normalize(matchup.home)
    if (!home || !away || (!direct && !reversed)) { failures++; continue }
    const result = await publishSeasonBracketFinal({ sport: "ncaaf", season: input.season, seriesNumber: row.seriesNumber,
      homeScore: Number(direct ? game.homePoints : game.awayPoints), awayScore: Number(direct ? game.awayPoints : game.homePoints),
      expectedHome: matchup.home, expectedAway: matchup.away })
    if (!result.ok) failures++
    else if (result.updatedPools > 0) published++
  }
  return { published, failures }
}
