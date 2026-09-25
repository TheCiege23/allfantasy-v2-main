/**
 * The set of source team ids an adapter should mark `is_commissioner`, from a provider's own
 * commissioner list.
 *
 * ⚠ `is_commissioner` BECOMES `LeagueTeam.isCommissioner`, WHICH IS A PERMISSION, NOT A LABEL.
 * `lib/commissioner/permissions.ts` accepts a claimed team carrying it. So a provider flag that
 * lands on every team — a misread member field, a shape change — must identify no one rather
 * than make every manager a commissioner. A league where each team is the commissioner has no
 * commissioner we can name; the League.userId owner still holds the role.
 */
export function commissionerTeamSet(
  commissionerIds: readonly string[] | null | undefined,
  teamIds: readonly string[],
): ReadonlySet<string> {
  const known = new Set(teamIds)
  const flagged = new Set((commissionerIds ?? []).filter((id) => Boolean(id) && known.has(id)))
  if (teamIds.length > 1 && flagged.size >= teamIds.length) return new Set()
  return flagged
}
