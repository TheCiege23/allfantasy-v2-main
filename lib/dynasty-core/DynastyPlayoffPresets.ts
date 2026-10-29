/**
 * Dynasty playoff presets (4/6/8/10 team). Avoid Week 18 title; 13–14 week regular season.
 */
import { DYNASTY_PLAYOFF_PRESETS, DYNASTY_DEFAULT_REGULAR_SEASON_WEEKS, isDynastyFootballSport } from './constants'
import type { DynastyPlayoffPresetDto } from './types'

/** NFL: title week 17 so playoff start 15; 14-week regular season default. */
const NFL_PLAYOFF_START_WEEK = 15
const NFL_TITLE_WEEK = 17

/**
 * Get playoff preset DTOs for UI.
 */
export function getDynastyPlayoffPresetList(sport: string = 'NFL'): DynastyPlayoffPresetDto[] {
  return DYNASTY_PLAYOFF_PRESETS.map((p) => {
    const byes = getFirstRoundByes(p.playoffTeamCount)
    const weeks = getPlayoffWeeks(p.playoffTeamCount)
    return {
      playoffTeamCount: p.playoffTeamCount,
      label: p.label,
      firstRoundByes: byes,
      playoffWeeks: weeks,
      // Was `sport === 'NFL' ? 15 : 15`: every sport got week 15, and the settings PUT wrote it into
      // NBA/MLB/NHL leagues whose regular seasons run 20+ weeks — starting playoffs mid-season.
      playoffStartWeek: isDynastyFootballSport(sport) ? NFL_PLAYOFF_START_WEEK : null,
    }
  })
}

function getFirstRoundByes(teamCount: number): number {
  if (teamCount <= 4) return 0
  if (teamCount <= 6) return 2
  if (teamCount <= 8) return 2
  return 2
}

function getPlayoffWeeks(teamCount: number): number {
  if (teamCount <= 4) return 2
  if (teamCount <= 6) return 3
  if (teamCount <= 8) return 3
  return 4
}

/**
 * Default regular season weeks for dynasty (avoid Week 18 title).
 */
export function getDynastyDefaultRegularSeasonWeeks(): number {
  return DYNASTY_DEFAULT_REGULAR_SEASON_WEEKS
}
