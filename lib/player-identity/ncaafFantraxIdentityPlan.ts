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

export function planNcaafFantraxIdentityLinks(refs: FantraxPlayerRef[], identities: NcaafIdentityRow[], seasonSchools: string[] = []) {
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
    const name = nameKey(ref.name), team = resolveSchool(ref.team), roles = positions(ref.position)
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
