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
