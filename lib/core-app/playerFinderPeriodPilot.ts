/** Period advice stays off until a reviewed league is explicitly enabled server-side. */
export function isFinderPeriodPilotLeague(leagueId: string, allowlist = process.env.PLAYER_FINDER_PERIOD_PILOT_LEAGUE_IDS): boolean {
  return Boolean(allowlist?.split(',').some((id) => id.trim() === leagueId))
}
