/**
 * Does a playoff bracket fit inside the season? Pure, dependency-free — the settings panels import it.
 *
 * 🛑 A BRACKET THAT OUTLASTS THE SEASON NEVER COMPLETES. `RedraftSeason.totalWeeks` is fixed when the
 * season is created (NFL 17, NBA 25, NHL 28, MLB 27) and nothing resizes it, so a final played in a
 * week past it is never sealed, never scored, and no champion is ever crowned. The bracket's length
 * depends on four settings at once — team count (rounds = ceil(log2(teams))), start week, weeks per
 * round, and championship length (the final can run longer, 2 weeks for MLB/NHL) — and only the last
 * one used to be checked. A 9-to-16-team bracket is four rounds, which overruns every sport's default
 * playoff window.
 *
 * ⚠ A BRACKET THAT ENDS EARLY IS WRONG TOO, MORE QUIETLY. A 4-team bracket started in the week sized for
 * a 6-team one crowns its champion a week before the season's end and leaves the last week unplayed.
 * `fittedPlayoffStartWeek` places the final in the season's last week instead.
 *
 * The weeks themselves come from `playoffRoundWeeks.ts`, the rule the scorer uses — series mode
 * included: a best-of-N round lasts N weeks, so `rounds × N` weeks must fit before the season ends.
 */

import { lastWeekOfPlayoffRound } from './playoffRoundWeeks'

/** The bracket engine supports at most 16 teams (four rounds) — canonicalNflRedraftPlayoffRuntime. */
export const MAX_PLAYOFF_TEAMS = 16

/** Single-elimination rounds a field of `teams` plays; 0 when there is no bracket. */
export function playoffRoundsForTeams(teams: number | null | undefined): number {
  const n = Math.floor(Number(teams))
  return Number.isFinite(n) && n >= 2 ? Math.ceil(Math.log2(n)) : 0
}

/** First-round byes: the gap to the next power of two (6 teams -> 2, 4 -> 0, 5 -> 3). */
export function firstRoundByesForTeams(teams: number | null | undefined): number {
  const rounds = playoffRoundsForTeams(teams)
  return rounds === 0 ? 0 : 2 ** rounds - Math.floor(Number(teams))
}

type BracketShape = {
  teams: number | null | undefined
  weeksPerRound?: number | null
  championshipLength?: number | null
  /** Series mode (lib/playoff-runtime/playoffSeries.ts): each round lasts its best-of length. */
  seriesLengths?: readonly number[] | null
}

/** How many weeks the bracket is played over, the final included; 0 when there is no bracket. */
export function playoffBracketWeeks(input: BracketShape): number {
  const rounds = playoffRoundsForTeams(input.teams)
  if (rounds === 0) return 0
  return lastWeekOfPlayoffRound({
    playoffStartWeek: 1,
    roundNumber: rounds,
    weeksPerRound: input.weeksPerRound,
    finalRoundNumber: rounds,
    championshipLength: input.championshipLength,
    seriesLengths: input.seriesLengths,
  })
}

/** The week the final ends, or null when there is no bracket. */
export function playoffFinalWeek(input: BracketShape & { playoffStartWeek: number }): number | null {
  const weeks = playoffBracketWeeks(input)
  return weeks === 0 ? null : Math.max(1, Math.floor(input.playoffStartWeek)) + weeks - 1
}

/** The start week that puts the final in the season's last week; null when there is no bracket. */
export function fittedPlayoffStartWeek(input: BracketShape & { seasonWeeks: number }): number | null {
  const weeks = playoffBracketWeeks(input)
  if (weeks === 0) return null
  return Math.max(2, Math.floor(input.seasonWeeks) - weeks + 1)
}

/**
 * The largest playoff field whose final still ends by `seasonWeeks`, capped by the league's size and
 * MAX_PLAYOFF_TEAMS. 0 when not even a two-team final fits.
 */
export function maxPlayoffTeamsThatFit(input: {
  seasonWeeks: number
  playoffStartWeek: number
  weeksPerRound?: number | null
  championshipLength?: number | null
  seriesLengths?: readonly number[] | null
  leagueSize?: number | null
}): number {
  const size = Math.floor(Number(input.leagueSize))
  const cap = Math.min(MAX_PLAYOFF_TEAMS, Number.isFinite(size) && size >= 2 ? size : MAX_PLAYOFF_TEAMS)
  for (let teams = cap; teams >= 2; teams--) {
    const final = playoffFinalWeek({ ...input, teams })
    if (final != null && final <= input.seasonWeeks) return teams
  }
  return 0
}
