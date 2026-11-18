/**
 * Who runs a team. Pure, client-safe.
 *
 * A roster's `platformUserId` is its unique key in the league. For a manager's first team it is their
 * user id; for a second or later team in a league that allows it (lib/league/multiTeamManagers.ts) it is
 * a key of the team's own, and `managerUserId` names the manager. Rows written before the column existed
 * have it null. So "does this user run this team" is always both fields, through this module.
 */

const EXTRA_TEAM_KEY_PREFIX = 'mgr:'

/** The owner key of a manager's additional team: unique per team, and never mistaken for a user id. */
export function extraTeamOwnerKey(userId: string, rosterId: string): string {
  return `${EXTRA_TEAM_KEY_PREFIX}${userId}:${rosterId}`
}

export function isExtraTeamOwnerKey(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(EXTRA_TEAM_KEY_PREFIX)
}

type ManagedRoster = { platformUserId?: string | null; managerUserId?: string | null }

export function isRosterManagedBy(roster: ManagedRoster | null | undefined, userId: string | null | undefined): boolean {
  if (!roster || !userId) return false
  return roster.managerUserId === userId || roster.platformUserId === userId
}

/** The id to compare managers by: the named manager, else the owner key (a user id or a provider id). */
export function rosterManagerKey(roster: ManagedRoster): string | null {
  const manager = String(roster.managerUserId ?? '').trim()
  if (manager) return manager
  const owner = String(roster.platformUserId ?? '').trim()
  return owner || null
}

/** A `where` for every roster this user runs in a league. */
export function managedRosterWhere(leagueId: string, userId: string) {
  return { leagueId, OR: [{ platformUserId: userId }, { managerUserId: userId }] }
}

/**
 * The key a team's own lists are stored under: its draft queue and its waiver watchlist.
 *
 * Those tables are keyed by a user id. A manager's first team keeps that key, so nothing already stored
 * moves; each further team gets a key of its own (`team:<rosterId>`), so two teams run by one manager do
 * not share a queue or a watchlist. Short enough for the watchlist's 64-character column.
 */
export function teamScopedKey(roster: { id: string; platformUserId?: string | null; managerUserId?: string | null }): string | null {
  if (isExtraTeamOwnerKey(roster.platformUserId)) return `team:${roster.id}`
  return rosterManagerKey(roster)
}
