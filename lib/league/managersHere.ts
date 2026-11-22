/**
 * "Who is already here": the managers in a league who have an AllFantasy account on their team.
 *
 * Owner's ask, 2026-11-21: league mates arriving from Sleeper and Fantrax import a league that is
 * already on AllFantasy and are put on their own team, but could not see who else from the league had
 * made it over. The invite panel showed a count ("5 of 12 teams claimed") and no names.
 *
 * Shown only to people already in the league (the route that serves this requires the owner or a
 * claimed team), and it says no more than the league itself already shows them: a name and a team.
 * Pure: no IO.
 */
export type ClaimedTeamRow = { teamName: string | null; ownerName: string | null; claimedByUserId: string | null }
export type ManagerHere = { name: string; teamName: string | null; you: boolean }

export const MANAGERS_HERE_LIMIT = 40

export function managersHere(
  teams: readonly ClaimedTeamRow[],
  displayNameByUserId: ReadonlyMap<string, string>,
  viewerUserId: string | null,
): ManagerHere[] {
  const seen = new Set<string>()
  const out: ManagerHere[] = []
  for (const t of teams) {
    const id = t.claimedByUserId
    if (!id || seen.has(id)) continue
    seen.add(id)
    const name = displayNameByUserId.get(id)?.trim() || t.ownerName?.trim() || 'Manager'
    out.push({ name, teamName: t.teamName?.trim() || null, you: id === viewerUserId })
  }
  // The viewer first, then by name: the list reads the same on every load.
  return out.sort((a, b) => Number(b.you) - Number(a.you) || a.name.localeCompare(b.name)).slice(0, MANAGERS_HERE_LIMIT)
}
