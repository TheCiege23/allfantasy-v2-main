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
  return (
    settings != null &&
    typeof settings === 'object' &&
    !Array.isArray(settings) &&
    (settings as Record<string, unknown>)[ALLOW_MULTI_TEAM_MANAGERS_SETTINGS_KEY] === true
  )
}
