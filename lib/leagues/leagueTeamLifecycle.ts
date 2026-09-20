/**
 * The ONE definition of "the league's current teams", for every read that enumerates a league.
 *
 * 🛑 WHY THIS HAS TO EXIST. `applySleeperLeagueSync` now ARCHIVES a vanished franchise that carries
 * history instead of deleting it, because `leagueTeam.delete` cascades away `TeamPerformance` and
 * SetNulls `LeagueSeason.championTeamId` — irreversible, and silent. The row therefore survives, and
 * 23 league-wide `leagueTeam.findMany` sites would list a departed franchise in the standings unless
 * they say otherwise. Before this module there was no canonical team reader at all
 * (`lib/leagues/rosterTeamIdentity.ts` is a JOIN rule, not a read helper), so each of those sites
 * would have had to re-derive the rule and one of them would get it wrong.
 *
 * 🛑 THE DISCRIMINATOR IS `lifecycleState`, NEVER `archivedAt`, AND THE SCHEMA SAYS SO IN ITS OWN
 * COMMENT: "`archivedAt IS NULL` does not mean current, because UNKNOWN rows also have no
 * timestamp." Filtering on the timestamp reads every unclassified row as current — which is 3,300
 * of 3,300 rows on the test database today — so it would look like it worked, and would also hide
 * nothing. `archivedAt` is metadata FOR the transition; it is not the transition.
 *
 * ⚠ AND IT IS `not: ARCHIVED`, NOT `equals: CURRENT`. `UNKNOWN` is the column default and is
 * deliberate: an existing row has not been classified, and calling it CURRENT would be a guess that
 * hides a departed team while calling it ARCHIVED would hide a live one. Asking for CURRENT would
 * therefore hide EVERY row nothing has classified yet — every team in the product today. Excluding
 * only what is positively known to be archived changes nothing for an unclassified row, which is
 * what makes this safe to apply to a live read.
 */
import type { Prisma } from '@prisma/client'

/**
 * Prisma `where` fragment: the league's teams, minus the ones positively known to have left.
 *
 * Spread it into an existing filter — `where: { leagueId, ...CURRENT_TEAMS }` — rather than
 * replacing the filter, so a site's own scoping survives.
 */
export const CURRENT_TEAMS = {
  lifecycleState: { not: 'ARCHIVED' },
} satisfies Prisma.LeagueTeamWhereInput

/**
 * In-memory counterpart, for a list that is already loaded or that comes from somewhere other than
 * a direct query. Same rule, so the two can never disagree.
 */
export function isArchivedTeam(team: { lifecycleState?: string | null }): boolean {
  return team.lifecycleState === 'ARCHIVED'
}

/**
 * Keep only the current teams of an already-loaded list.
 *
 * ⚠ A row whose `lifecycleState` was not selected is KEPT, deliberately. A caller that did not ask
 * for the column cannot have its rows silently dropped — that would turn a forgotten `select` into
 * an empty league, which is a far worse failure than showing one departed team.
 */
export function currentTeamsOnly<T extends { lifecycleState?: string | null }>(teams: T[]): T[] {
  return teams.filter((t) => !isArchivedTeam(t))
}
