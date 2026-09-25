/**
 * The importer's manager id in the SAME key space the imported rosters use.
 *
 * 🛑 WHY THIS EXISTS: MFL's commissioner gate proves membership with the caller's own API key and
 * answers with their FRANCHISE id (`0003`). The imported rosters key each team's manager on MFL's
 * `owner_id` whenever the league publishes one, and only fall back to the franchise id when it does
 * not (`MflLeagueFetchService` → `MflAdapter`: `source_team_id` = franchise id, `source_manager_id` =
 * owner id). So in every league that publishes owner ids the gate's id matched NO roster: the
 * bootstrap claim looked it up by `source_manager_id` and `claimExistingLeagueForMember` by
 * `platformUserId`, and the importer ended up owning a league with no team of their own.
 *
 * For MFL the franchise id IS the team id, so the proven franchise is translated through this
 * league's own rosters to that team's manager key. That keeps it provider-proven — it is the
 * same team, read from the same payload — rather than a guess. Every other provider's gate
 * already answers in the rosters' key space and passes through untouched.
 */
export function importerManagerIdForRosters(
  provider: string,
  gateManagerId: string | null | undefined,
  rosters:
    | ReadonlyArray<{ source_team_id?: string | number | null; source_manager_id?: string | number | null }>
    | null
    | undefined,
): string | null {
  const id = gateManagerId == null ? '' : String(gateManagerId).trim()
  if (!id) return null
  if (provider.trim().toLowerCase() !== 'mfl') return id

  // The franchise id is the team id, so the team is authoritative. Where the league publishes no
  // owner ids the rosters fell back to the franchise id and this returns `id` unchanged.
  const team = (rosters ?? []).find((r) => r.source_team_id != null && sameFranchise(String(r.source_team_id), id))
  const manager = team?.source_manager_id == null ? '' : String(team.source_manager_id).trim()
  return manager || id
}

/**
 * MFL franchise ids are zero-padded strings ("0003"). Compared as strings, never `Number()` —
 * but a padded and an unpadded spelling of the same all-digit id are the same franchise.
 */
function sameFranchise(a: string, b: string): boolean {
  const x = a.trim()
  const y = b.trim()
  if (x === y) return true
  return /^\d+$/.test(x) && /^\d+$/.test(y) && x.replace(/^0+/, '') === y.replace(/^0+/, '')
}
