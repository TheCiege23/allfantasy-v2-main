import { buildStrictPlayerKey, normalizePosition, normalizeTeamAbbr } from './playerIdentityResolution'

type EspnAthlete = { id: string; name: string; position: string; team: string }
type CollegeIdentity = {
  id: string
  canonicalName: string
  position: string | null
  currentTeam: string | null
  cfbdId: string | null
  espnId: string | null
}

/** Match imported ESPN roster evidence to the CFBD-linked registry within college football. */
export function planNcaafEspnIdentityLinks(refs: readonly EspnAthlete[], rows: readonly CollegeIdentity[]) {
  const sport = 'NCAAF'
  const key = (name: string, position: string | null, team: string | null) => {
    if (!name.trim() || !normalizePosition(position, sport) || !normalizeTeamAbbr(team, sport)) return null
    return buildStrictPlayerKey({ name, position, team, sport })
  }
  const byKey = new Map<string, CollegeIdentity[]>()
  const existingIds = new Set(rows.map((r) => r.espnId))
  const cfbdCounts = new Map<string, number>()
  for (const row of rows) {
    if (row.cfbdId) cfbdCounts.set(row.cfbdId, (cfbdCounts.get(row.cfbdId) ?? 0) + 1)
    const k = key(row.canonicalName, row.position, row.currentTeam)
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), row])
  }
  const proposed = refs.flatMap((ref) => {
    const k = key(ref.name, ref.position, ref.team)
    if (!k || !/^\d+$/.test(ref.id) || existingIds.has(ref.id)) return []
    const candidates = byKey.get(k)
    if (candidates?.length !== 1) return []
    const row = candidates[0]!
    return row.cfbdId && cfbdCounts.get(row.cfbdId) === 1 && !row.espnId ? [{ id: row.id, espnId: ref.id, cfbdId: row.cfbdId }] : []
  })
  const counts = new Map<string, number>()
  for (const link of proposed) counts.set(link.cfbdId, (counts.get(link.cfbdId) ?? 0) + 1)
  return proposed.filter((link) => counts.get(link.cfbdId) === 1)
}
