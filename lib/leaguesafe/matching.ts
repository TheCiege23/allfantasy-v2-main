/**
 * LeagueSafe → AllFantasy matching rules. Pure, client-safe, no I/O.
 *
 * A LeagueSafe notification names a LEAGUE and a PAYER, both as free text. Neither is an identity:
 * - the league name routes an email to a connection only when exactly one connection has that name;
 * - the payer name only SUGGESTS a team. Nothing is credited to a team until the commissioner confirms
 *   who that payer is, because a wrong match would mark the wrong manager paid.
 */

export function normalizeLeagueSafeName(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function leagueSafeNamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeLeagueSafeName(a)
  return left.length > 0 && left === normalizeLeagueSafeName(b)
}

type TeamForMatch = { id: string; teamName: string | null; ownerName: string | null }

/** The one team whose owner or team name is exactly the payer's name, or null when none or several are. */
export function suggestTeamForPayer(payerName: string, teams: readonly TeamForMatch[]): { teamId: string; method: 'name_exact' } | null {
  const wanted = normalizeLeagueSafeName(payerName)
  if (!wanted) return null
  const hits = teams.filter(
    (team) => normalizeLeagueSafeName(team.ownerName) === wanted || normalizeLeagueSafeName(team.teamName) === wanted,
  )
  return hits.length === 1 ? { teamId: hits[0]!.id, method: 'name_exact' } : null
}

/**
 * Dues are owed per TEAM. A manager who runs several teams pays for each, in one LeagueSafe payment or
 * several, so a confirmed payer covers every team claimed by the same manager as the team they were
 * matched to. An unclaimed team stands alone.
 */
export function teamsCoveredByPayer(
  matchedTeamId: string,
  teams: ReadonlyArray<{ id: string; claimedByUserId: string | null }>,
): string[] {
  const matched = teams.find((team) => team.id === matchedTeamId)
  if (!matched) return []
  if (!matched.claimedByUserId) return [matched.id]
  return teams.filter((team) => team.claimedByUserId === matched.claimedByUserId).map((team) => team.id)
}

/** What this payer owes: their own override, else the league's dues for every team they run. */
export function payerDuesCents(input: { baseDuesCents: number; memberOverrideCents: number | null | undefined; teamsCovered: number }): number {
  if (input.memberOverrideCents != null) return input.memberOverrideCents
  return input.baseDuesCents * Math.max(1, input.teamsCovered)
}
