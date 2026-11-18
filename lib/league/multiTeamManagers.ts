/**
 * "A manager may run more than one team": a commissioner's opt-in for leagues where one person runs
 * several franchises.
 *
 * Each team still belongs to its own AllFantasy account (a roster has one owner per league). With the
 * setting off, a person whose other account already holds a team is refused a second one. With it on,
 * that refusal is lifted for this league, so a manager can take another team under another account.
 * Stored on `League.settings.allow_multi_team_managers`; only a stored `true` counts as on.
 */

export const ALLOW_MULTI_TEAM_MANAGERS_SETTINGS_KEY = 'allow_multi_team_managers' as const

export function readAllowMultiTeamManagers(settings: unknown): boolean {
  // A format that seats one person per team never allows it, whatever is stored.
  if (!multiTeamManagersSupported({ settings })) return false
  return (
    settings != null &&
    typeof settings === 'object' &&
    !Array.isArray(settings) &&
    (settings as Record<string, unknown>)[ALLOW_MULTI_TEAM_MANAGERS_SETTINGS_KEY] === true
  )
}

/**
 * Elimination and cast formats (Survivor, Big Brother, Zombie, Guilly and their variants) are built
 * around one person per seat: votes, tribes, alliances. Several teams for one manager is offered to
 * standard leagues only.
 */
const SINGLE_SEAT_FORMAT = /(survivor|big[_ ]?brother|zombie|guillotine|guilly|pirate|tournament)/i

export function multiTeamManagersSupported(league: { leagueVariant?: string | null; leagueType?: string | null; settings?: unknown }): boolean {
  const settings = league.settings != null && typeof league.settings === 'object' && !Array.isArray(league.settings) ? (league.settings as Record<string, unknown>) : {}
  const labels = [league.leagueVariant, league.leagueType, settings.league_type, settings.leagueType].map((v) => String(v ?? ''))
  return !labels.some((label) => SINGLE_SEAT_FORMAT.test(label))
}
