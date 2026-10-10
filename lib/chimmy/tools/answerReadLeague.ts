/**
 * Tools that read only the real world — stats, schedules, pro standings — or merely resolve a league
 * by name. None of them looks inside the user's league. Names match `CHIMMY_TOOL_SPECS`.
 */
export const WORLD_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'find_league_by_name',
  'get_player_game_log',
  'get_player_season_stats',
  'get_season_stat_leaders',
  'get_stat_leaders',
  'get_upcoming_games',
  'get_real_standings',
])

/**
 * Did this answer actually look inside a league? PURE.
 *
 * 🛑 THE "Read from <league>" LINE WAS SET WHENEVER A LEAGUE WAS SELECTED — including answers where
 * no tool ran at all, or only a stats lookup did. It promised the user their league was read when
 * nothing of it was. The line is now earned by at least one league-reading tool. Unlisted tools count
 * as league-reading, so a tool added later keeps the old behaviour rather than silently losing the line.
 *
 * ⚠ This is "a league lookup RAN", not "it found data": tools answer an absence in prose, not a flag.
 */
export function answerReadLeague(toolsUsed: readonly string[]): boolean {
  return toolsUsed.some((tool) => !WORLD_ONLY_TOOLS.has(tool))
}
