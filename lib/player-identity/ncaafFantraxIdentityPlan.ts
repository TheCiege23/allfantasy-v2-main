import type { FantraxPlayerRef } from '@/lib/league-import/fantrax/fantraxApi'
import { COLLEGE_NAME_ALIASES, CFBD_SCHOOL_ALIASES, exactKey, cfbdScheduleTeamKeys } from '@/lib/sports-data/collegeTeamNames'
import { normalizePlayerName } from '@/lib/team-abbrev'

export type NcaafIdentityRow = { id: string; canonicalName: string; currentTeam: string | null; position: string | null; fantraxId: string | null; cfbdId: string | null }
// Use only exact schools and documented aliases. Never remove generic school words:
// Miami University and University of Miami are different schools.
const schoolAliases: Record<string, string> = { ...COLLEGE_NAME_ALIASES, ...CFBD_SCHOOL_ALIASES, 'vanderbilt university': 'Vanderbilt' }
const school = (value: string | null) => exactKey(schoolAliases[exactKey(value)] ?? value)
const nameKey = (value: string) => { const parts = value.split(','); return normalizePlayerName(parts.length === 2 ? `${parts[1]} ${parts[0]}` : value) }
const positions = (value: string | null) => String(value ?? '').toUpperCase().split(/[,/\s]+/).filter(p => ['QB','RB','WR','TE','K','P','DL','DE','DT','LB','DB','CB','S'].includes(p))

export function planNcaafFantraxIdentityLinks(refs: FantraxPlayerRef[], identities: NcaafIdentityRow[], seasonSchools: string[] = [], providerSchoolAliases: Readonly<Record<string, string>> = {}) {
  // Only the current CFBD schedule establishes a school suffix match. A loose
  // key shared by distinct schools never authorizes an identity link.
  const exactSchools = new Set<string>()
  const looseSchools = new Map<string, Set<string>>()
  for (const value of seasonSchools) {
    const keys = cfbdScheduleTeamKeys(value)
    if (!keys.exact) continue
    exactSchools.add(keys.exact)
    const set = looseSchools.get(keys.loose) ?? new Set<string>(); set.add(keys.exact); looseSchools.set(keys.loose, set)
  }
  const resolveSchool = (value: string | null) => {
    if (!seasonSchools.length) return school(value)
    const keys = cfbdScheduleTeamKeys(value)
    if (exactSchools.has(keys.exact)) return keys.exact
    const candidates = looseSchools.get(keys.loose)
    return candidates?.size === 1 ? [...candidates][0]! : ''
  }
  const byName = new Map<string, NcaafIdentityRow[]>()
  for (const row of identities) { const key = nameKey(row.canonicalName); byName.set(key, [...(byName.get(key) ?? []), row]) }
  const proposed: Array<{ id: string; fantraxId: string; cfbdId: string }> = []
  const existing = new Set(identities.map(row => row.fantraxId).filter(Boolean))
  let unmatched = 0, ambiguous = 0, conflicts = 0, unchanged = 0
  for (const ref of refs) {
    const name = nameKey(ref.name), team = resolveSchool(providerSchoolAliases[exactKey(ref.team)] ?? ref.team), roles = positions(ref.position)
    if (!ref.fantraxId || !name || !team || !roles.length) { unmatched++; continue }
    const candidates = (byName.get(name) ?? []).filter(row => row.cfbdId && nameKey(row.canonicalName) === name && resolveSchool(row.currentTeam) === team && positions(row.position).some(p => roles.includes(p)))
    if (!candidates.length) { unmatched++; continue }
    if (candidates.length !== 1) { ambiguous++; continue }
    const row = candidates[0]!
    if (row.fantraxId === ref.fantraxId) { unchanged++; continue }
    if (row.fantraxId || existing.has(ref.fantraxId)) { conflicts++; continue }
    proposed.push({ id: row.id, fantraxId: ref.fantraxId, cfbdId: row.cfbdId! })
  }
  const counts = new Map<string, number>()
  for (const link of proposed) for (const key of [`id:${link.id}`, `cfbd:${link.cfbdId}`, `source:${link.fantraxId}`]) counts.set(key, (counts.get(key) ?? 0) + 1)
  const links = proposed.filter(link => [`id:${link.id}`, `cfbd:${link.cfbdId}`, `source:${link.fantraxId}`].every(key => counts.get(key) === 1))
  return { links, unmatched, ambiguous: ambiguous + proposed.length - links.length, conflicts, unchanged, provided: refs.length }
}

export type CfbdSchoolFact = { cfbdId: string; name: string; school: string }

/** Learn a provider school code only from three distinct, already-linked current-season athletes.
 * Every anchor must agree on identity, name, position, registry school and CFBD game school.
 * Conflicting codes, duplicate IDs and transferred/ambiguous game affiliations teach nothing.
 */
export function verifiedFantraxSchoolAliases(refs: FantraxPlayerRef[], identities: NcaafIdentityRow[], facts: CfbdSchoolFact[], seasonSchools: string[]) {
  const factById = new Map<string, CfbdSchoolFact[]>()
  for (const fact of facts) factById.set(fact.cfbdId, [...(factById.get(fact.cfbdId) ?? []), fact])
  const identitiesBySource = new Map<string, NcaafIdentityRow[]>()
  for (const row of identities) if (row.fantraxId) identitiesBySource.set(row.fantraxId, [...(identitiesBySource.get(row.fantraxId) ?? []), row])
  const scheduled = new Map<string, Set<string>>()
  for (const name of seasonSchools) {const k=cfbdScheduleTeamKeys(name); const set=scheduled.get(k.loose)??new Set<string>();set.add(k.exact);scheduled.set(k.loose,set)}
  const resolve = (value: string|null) => {const k=cfbdScheduleTeamKeys(value);const options=scheduled.get(k.loose);return options?.size===1?[...options][0]!:''}
  const claims = new Map<string, Map<string, Set<string>>>()
  const sourceCounts = new Map<string,number>()
  for (const ref of refs) sourceCounts.set(ref.fantraxId,(sourceCounts.get(ref.fantraxId)??0)+1)
  for (const ref of refs) {
    if (sourceCounts.get(ref.fantraxId)!==1) continue
    const candidates=identitiesBySource.get(ref.fantraxId)
    if (candidates?.length!==1) continue
    const row=candidates[0]!, code=exactKey(ref.team), role=positions(ref.position)
    if (!code || !row.cfbdId || nameKey(ref.name)!==nameKey(row.canonicalName) || !role.some(p=>positions(row.position).includes(p))) continue
    const games=factById.get(row.cfbdId)??[]
    if (!games.length || games.some(f=>nameKey(f.name)!==nameKey(ref.name))) continue
    const schools=new Set(games.map(f=>resolve(f.school)))
    if (schools.size!==1 || schools.has('')) continue
    const school=[...schools][0]!
    if (resolve(row.currentTeam)!==school) continue
    const bySchool=claims.get(code)??new Map<string,Set<string>>()
    const athletes=bySchool.get(school)??new Set<string>();athletes.add(row.cfbdId);bySchool.set(school,athletes);claims.set(code,bySchool)
  }
  const aliases:Record<string,string>={}
  for (const [code,schools] of claims) if (schools.size===1) {const [school,athletes]=[...schools][0]!;if(athletes.size>=3)aliases[code]=school}
  return aliases
}
