import { prisma } from '@/lib/prisma'

/**
 * The one place a Commissioner OS manager id becomes a human name.
 *
 * 🛑 THERE WERE TWO COPIES OF THIS, AND BOTH WERE WRONG THE SAME WAY. Manager Intelligence and
 * Mission Control each carried their own `resolveManagerDisplayNames` that passed the id
 * straight into `appUser.findMany({ id: { in } })`. A manager id from the intelligence API is
 * `sleeper:<providerId>` for any imported league; `app_users.id` is a UUID. Measured on prod
 * 2026-09-09: 1,137 of the 1,153 observed manager keys are provider-shaped and **zero** of them
 * match an AppUser row. The lookup could not succeed by construction.
 *
 * The two copies then failed differently, which is how it stayed invisible for so long:
 * Manager Intelligence rendered "Unknown manager" for 98.6% of every directory, while Mission
 * Control fell back to the id itself and printed `sleeper:1267977501351628801` into the UI.
 *
 * The names were never missing. `league_teams` holds `ownerName` and `teamName` against that
 * same provider id and covers **1,132 of the 1,137**. This module is one implementation of that
 * rule so the two surfaces cannot drift again — the duplication was the actual defect.
 */

/** What a caller renders when neither source can name a manager. Shared so both surfaces agree. */
export const UNKNOWN_MANAGER_NAME = 'Unknown manager'

/**
 * Resolve display names for a league's manager ids, from both id spaces.
 *
 * ⚠ SCOPED TO ONE LEAGUE ON PURPOSE. `platformUserId` is a provider id, not an AllFantasy one,
 * so the same person carries it in every league they play in. An unscoped query would return
 * several team names per manager and pick an arbitrary one — a name that looks right and
 * belongs to a different league.
 *
 * Ids are returned keyed by the ORIGINAL id the caller passed, prefix included, so a caller can
 * look up exactly what it handed over.
 */
export async function resolveManagerDisplayNames(
  leagueId: string,
  managerIds: readonly string[],
): Promise<Map<string, string>> {
  if (managerIds.length === 0) return new Map()
  const names = new Map<string, string>()

  /*
   * The `:` is the discriminator, and it is the one the event mapper writes — a provider-scoped
   * key is `<provider>:<id>`, an AllFantasy account id is a bare UUID. `indexOf > 0` rather than
   * `includes`, so a malformed leading-colon id falls to the AppUser branch and simply misses,
   * instead of producing an empty provider id that would match every team with a null column.
   */
  const providerKeys = new Map<string, string>() // providerId → the original prefixed id
  const afUserIds: string[] = []
  for (const id of managerIds) {
    const separator = id.indexOf(':')
    if (separator > 0) providerKeys.set(id.slice(separator + 1), id)
    else afUserIds.push(id)
  }

  const [users, teams] = await Promise.all([
    afUserIds.length
      ? prisma.appUser.findMany({
          where: { id: { in: afUserIds } },
          select: { id: true, displayName: true, username: true },
        })
      : Promise.resolve([]),
    providerKeys.size
      ? prisma.leagueTeam.findMany({
          where: { leagueId, platformUserId: { in: [...providerKeys.keys()] } },
          select: { platformUserId: true, ownerName: true, teamName: true },
        })
      : Promise.resolve([]),
  ])

  // AF-linked accounts first: a manager who has claimed their team should be shown under the
  // name they chose here, not the one the provider holds for them.
  for (const user of users) names.set(user.id, user.displayName ?? user.username)

  for (const team of teams) {
    const originalId = team.platformUserId ? providerKeys.get(team.platformUserId) : undefined
    if (!originalId || names.has(originalId)) continue
    /*
     * Both columns are non-null in the schema but hold an empty string for an unclaimed or
     * partially-imported team. Empty is not a name: rendering it produces a blank row that reads
     * as a broken component, where the shared fallback at least reads as a gap in the data.
     */
    const name = team.ownerName?.trim() || team.teamName?.trim()
    if (name) names.set(originalId, name)
  }

  return names
}
