/**
 * The names one manager goes by, beside the roster's label. On an imported Sleeper league the Trade
 * Center labels a roster with its TEAM name ("Dolphins (B2B Champs)"), while a Sleeper DM card names
 * the MANAGER ("@JeffersonTD", "2028 2nd Rd (JeffersonTD)"). Both name the same person, so a
 * screenshot's label has to be compared against every one of them.
 *
 * Sources: `LeagueTeam.ownerName` and the account name (passed in as `extra`), and the import's
 * `playerData.import.ownerName` / `displayName`. All are already stored at import — no re-sync.
 */
export function rosterManagerHandles(playerData: unknown, extra: ReadonlyArray<string | null | undefined> = []): string[] {
  const out: string[] = []
  const push = (v: unknown) => {
    if (typeof v !== 'string') return
    const s = v.trim()
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s)
  }
  for (const v of extra) push(v)
  if (playerData && typeof playerData === 'object' && !Array.isArray(playerData)) {
    const meta = (playerData as Record<string, unknown>).import
    if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
      push((meta as Record<string, unknown>).ownerName)
      push((meta as Record<string, unknown>).displayName)
    }
  }
  return out
}

/**
 * The manager's own name to show beside a roster label, or null when the label already is that name.
 * A Sleeper roster is labelled with the team name ("Dolphins (B2B Champs)"), while trades and DMs name
 * the manager ("JeffersonTD"); showing both lets a manager be found by either. The first handle is the
 * stored league manager name, so that is the one shown.
 */
export function managerNameBesideLabel(label: string | null | undefined, handles: ReadonlyArray<string> | null | undefined): string | null {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const first = handles?.[0]?.trim()
  if (!first) return null
  if (label && key(label) === key(first)) return null
  return first
}
