import type { SectionState } from './leagueHome'
import { buildNextGameMap, type FixtureRow } from './nextGameMap'
import type { SportsWeek } from './sportsWeek'

/**
 * The game a player plays this week, from the week's fixture rows — the
 * instant every lineup lock on his card counts down to.
 *
 * Pure. The loader filters the week in SQL (season + week + seasonType, per
 * the schema's own warning) and hands the rows here; the club is matched in
 * memory through buildNextGameMap, because SportsGame carries provider
 * display names and rosters carry abbreviations (see nextGameMap.ts). One
 * fixture arrives up to four times; the map keeps the row that knows.
 */

export type PlayerGame = {
  /** ISO kickoff. */
  kickoff: string
  opponent: string
  home: boolean
  week: number
  season: number
  preseason: boolean
}

export function playerGame(games: readonly FixtureRow[], team: string | null, week: SportsWeek | null): SectionState<PlayerGame> {
  if (!team) return { available: false, reason: 'no team on file for him, so there is no game to find' }
  if (!week) return { available: false, reason: 'no upcoming week on the schedule for this sport' }
  const found = buildNextGameMap(games, new Set([team])).get(team)
  if (!found) return { available: false, reason: `no game on the schedule for ${team} in week ${week.week}` }
  return {
    available: true,
    data: { kickoff: found.at.toISOString(), opponent: found.opponent, home: found.home, week: week.week, season: week.season, preseason: found.preseason },
  }
}
