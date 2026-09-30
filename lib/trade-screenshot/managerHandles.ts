/**
 * The names one Sleeper manager goes by. A Sleeper DM card prints the login username
 * ("@JeffersonTD"); the league's rosters are labelled with the preferred display name. Both name the
 * same person, so a screenshot's label has to be compared against both.
 *
 * The sync stamps them into `Roster.playerData` (no schema column), so a league synced before that
 * has none — callers must treat an empty list as "unknown", never as "no match".
 */
export function rosterManagerHandles(playerData: unknown, accountUsername?: string | null): string[] {
  const out: string[] = []
  const push = (v: unknown) => {
    if (typeof v !== 'string') return
    const s = v.trim()
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s)
  }
  if (playerData && typeof playerData === 'object' && !Array.isArray(playerData)) {
    const blob = playerData as Record<string, unknown>
    push(blob.source_manager_username)
    push(blob.source_manager_display_name)
  }
  push(accountUsername)
  return out
}
