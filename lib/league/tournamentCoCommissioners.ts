/**
 * Co-commissioners who run a league WITHOUT holding a team in it.
 *
 * A league's own co-commissioner flag lives on a TEAM (`LeagueTeam.isCoCommissioner`), so it can
 * only describe somebody who holds a seat. Two kinds of people need the role without a seat:
 *
 *   - TOURNAMENT co-commissioners. A tournament co-commissioner usually entered at most one
 *     conference — or none — and must run every conference league without a team in it. The
 *     tournament records them on each league it owns, in `League.settings[TOURNAMENT_CO_COMMISSIONERS_KEY]`.
 *     The tournament is the only writer (lib/tournament/divisions/conferenceLeagueSync.ts), and it
 *     rewrites the list whenever its grants change, so a removal takes effect at once.
 *   - IMPORT co-commissioners: a provider-proven commissioner who imported a league another account
 *     had already imported, and had no team in it to claim. Recorded in
 *     `League.settings[IMPORT_CO_COMMISSIONERS_KEY]` by `joinExistingLeagueAsCoCommissioner`
 *     (lib/league-import/ImportedLeagueCommitService.ts).
 *
 * 🛑 TWO KEYS, ON PURPOSE. The tournament sync replaces its list wholesale and diffs team flags
 * against it, so an import grant stored there would be erased on the next sync. That is why
 * `tournamentCoCommissionerIds` stays tournament-only, while every PERMISSION check goes through
 * `isTournamentCoCommissioner` / `teamlessCoCommissionerIds`, which read both.
 *
 * Pure: no database access, safe to import from permission code and tests.
 */
export const TOURNAMENT_CO_COMMISSIONERS_KEY = 'tournamentCoCommissionerIds'
export const IMPORT_CO_COMMISSIONERS_KEY = 'importCoCommissionerIds'

function idsAt(settings: unknown, key: string): string[] {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return []
  const raw = (settings as Record<string, unknown>)[key]
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((v): v is string => typeof v === 'string' && v.length > 0))]
}

/** The tournament-granted co-commissioner ids stored on a league's settings JSON. Never throws. */
export function tournamentCoCommissionerIds(settings: unknown): string[] {
  return idsAt(settings, TOURNAMENT_CO_COMMISSIONERS_KEY)
}

/** Co-commissioners recorded by an import join. Never throws. */
export function importCoCommissionerIds(settings: unknown): string[] {
  return idsAt(settings, IMPORT_CO_COMMISSIONERS_KEY)
}

/** Everyone who co-commissions this league without a team: tournament grants and import joins. */
export function teamlessCoCommissionerIds(settings: unknown): string[] {
  return [...new Set([...tournamentCoCommissionerIds(settings), ...importCoCommissionerIds(settings)])]
}

/**
 * Whether this user co-commissions the league without a team, by EITHER route. The name predates the
 * import route; every permission reader already calls it, which is why it widened in place.
 */
export function isTournamentCoCommissioner(settings: unknown, userId: string | null | undefined): boolean {
  return Boolean(userId) && teamlessCoCommissionerIds(settings).includes(userId as string)
}
