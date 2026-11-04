import { ESPN_NCAAB_DEVY_ID_PREFIX } from '@/lib/devy/ncaabRosterEvidence'

type Identity = { id: string; espnId: string | null }
type Db = { playerIdentityMap: { findMany(args: { where: { sport: string; espnId: { in: string[] } }; select: { id: true; espnId: true } }): Promise<Identity[]> } }

/** Translate verified ESPN roster IDs into game-stat IDs without guessing by name.
 * Missing and ambiguous mappings are returned explicitly so callers can withhold scoring. */
export async function bridgeNcaabCampusIds(db: Db, rosterIds: readonly string[]) {
  const ids = [...new Set(rosterIds)]
  const providerIds = ids.map((id) => id.startsWith(ESPN_NCAAB_DEVY_ID_PREFIX) ? id.slice(ESPN_NCAAB_DEVY_ID_PREFIX.length) : '').filter((id) => /^\d+$/.test(id))
  const rows = providerIds.length ? await db.playerIdentityMap.findMany({
    where: { sport: 'NCAAB', espnId: { in: providerIds } }, select: { id: true, espnId: true },
  }) : []
  const byEspn = new Map<string, Set<string>>()
  for (const row of rows) {
    if (!row.espnId || !providerIds.includes(row.espnId)) continue
    const values = byEspn.get(row.espnId) ?? new Set<string>()
    values.add(row.id)
    byEspn.set(row.espnId, values)
  }
  const resolved = new Map<string, string>()
  const missing: string[] = []
  const ambiguous: string[] = []
  for (const rosterId of ids) {
    const providerId = rosterId.startsWith(ESPN_NCAAB_DEVY_ID_PREFIX) ? rosterId.slice(ESPN_NCAAB_DEVY_ID_PREFIX.length) : ''
    const matches = /^\d+$/.test(providerId) ? [...(byEspn.get(providerId) ?? [])] : []
    if (matches.length === 0) missing.push(rosterId)
    else if (matches.length > 1) ambiguous.push(rosterId)
    else resolved.set(rosterId, matches[0]!)
  }
  // Two roster IDs may never receive the same game log, even if corrupt identity data claims both.
  const owners = new Map<string, string[]>()
  for (const [rosterId, identityId] of resolved) owners.set(identityId, [...(owners.get(identityId) ?? []), rosterId])
  for (const duplicates of owners.values()) if (duplicates.length > 1) for (const rosterId of duplicates) { resolved.delete(rosterId); ambiguous.push(rosterId) }
  return { resolved, missing, ambiguous }
}
