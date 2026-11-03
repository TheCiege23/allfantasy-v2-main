import { canonicalName } from './player-canonical-identity'

export type ObservedAdpIdentityRow = { name: string; adp: number; canonicalPlayerIds?: readonly string[] }
export type AdpRegistryIdentity = { id: string; sport: string; canonicalName: string; rollingInsightsId: string | null }
export function observedAdpCanonicalId(sport: string, value: string): string | null {
  if (!['NBA', 'NHL', 'MLB'].includes(sport)) return null
  const prefix = sport + ':af:'
  const id = value.startsWith(prefix) ? value.slice(prefix.length) : ''
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null
}
/** ADP follows a registry-confirmed athlete when providers use different lineup positions.
 * Never change the pool's scoring ID, club or eligible positions, and refuse conflicting claims. */
export function buildObservedAdpIdentityIndex(sport: string, rows: readonly ObservedAdpIdentityRow[], identities: readonly AdpRegistryIdentity[]) {
  const registry = new Map(identities.filter(row => row.sport === sport).map(row => [row.id, row]))
  const claims = new Map<string, Map<string, { name: string; adp: number }>>()
  for (const row of rows) {
    if (!(Number.isFinite(row.adp) && row.adp > 0)) continue
    for (const value of row.canonicalPlayerIds ?? []) {
      const id = observedAdpCanonicalId(sport, value)
      const identity = id ? registry.get(id) : undefined
      if (!identity?.rollingInsightsId || !canonicalName(row.name) || canonicalName(identity.canonicalName) !== canonicalName(row.name)) continue
      const bucket = claims.get(identity.rollingInsightsId) ?? new Map()
      bucket.set(canonicalName(row.name) + '|' + row.adp, { name: row.name, adp: row.adp })
      claims.set(identity.rollingInsightsId, bucket)
    }
  }
  return new Map([...claims].flatMap(([id, values]) => values.size === 1 ? [[id, [...values.values()][0]!] as const] : []))
}
export function observedAdpForPlayer(index: ReturnType<typeof buildObservedAdpIdentityIndex>, rollingInsightsId: string | null | undefined, name: string): number | null {
  const hit = rollingInsightsId ? index.get(rollingInsightsId) : undefined
  return hit && canonicalName(hit.name) === canonicalName(name) ? hit.adp : null
}
