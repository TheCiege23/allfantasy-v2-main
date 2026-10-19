/**
 * Co-commissioners a tournament hands down to the real leagues it created.
 *
 * A league's own co-commissioner flag lives on a TEAM (`LeagueTeam.isCoCommissioner`), so it can
 * only describe somebody who holds a seat. A tournament co-commissioner usually entered at most one
 * conference — or none — and must run every conference league without being given a team in it.
 * The tournament therefore records its co-commissioners on each league it owns, in
 * `League.settings[TOURNAMENT_CO_COMMISSIONERS_KEY]`, and `getLeagueRole` reads that list as
 * `co_commissioner`. The tournament is the only writer (lib/tournament/divisions/conferenceLeagueSync.ts),
 * and it rewrites the list whenever its grants change, so a removal takes effect at once.
 *
 * Pure: no database access, safe to import from permission code and tests.
 */
export const TOURNAMENT_CO_COMMISSIONERS_KEY = 'tournamentCoCommissionerIds'

/** The tournament-granted co-commissioner ids stored on a league's settings JSON. Never throws. */
export function tournamentCoCommissionerIds(settings: unknown): string[] {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return []
  const raw = (settings as Record<string, unknown>)[TOURNAMENT_CO_COMMISSIONERS_KEY]
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((v): v is string => typeof v === 'string' && v.length > 0))]
}

export function isTournamentCoCommissioner(settings: unknown, userId: string | null | undefined): boolean {
  return Boolean(userId) && tournamentCoCommissionerIds(settings).includes(userId as string)
}
