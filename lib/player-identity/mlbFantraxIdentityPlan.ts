import type { FantraxPlayerRef } from '@/lib/league-import/fantrax/fantraxApi'

export type MlbIdentityRow = { id: string; canonicalName: string; currentTeam: string | null; position: string | null; fantraxId: string | null; rollingInsightsId: string | null }
const teams: Record<string, string[]> = {
  ARI: ['Arizona Diamondbacks', 'AZ', 'ARZ'], ATL: ['Atlanta Braves'], BAL: ['Baltimore Orioles'], BOS: ['Boston Red Sox'],
  CHC: ['Chicago Cubs'], CWS: ['Chicago White Sox', 'CHW'], CIN: ['Cincinnati Reds'], CLE: ['Cleveland Guardians', 'Cleveland Indians'],
  COL: ['Colorado Rockies'], DET: ['Detroit Tigers'], HOU: ['Houston Astros'], KC: ['Kansas City Royals', 'KCR'],
  LAA: ['Los Angeles Angels', 'Los Angeles Angels of Anaheim'], LAD: ['Los Angeles Dodgers'], MIA: ['Miami Marlins'], MIL: ['Milwaukee Brewers'],
  MIN: ['Minnesota Twins'], NYM: ['New York Mets'], NYY: ['New York Yankees'], ATH: ['Athletics', 'Oakland Athletics', 'OAK'],
  PHI: ['Philadelphia Phillies'], PIT: ['Pittsburgh Pirates'], SD: ['San Diego Padres', 'SDP'], SEA: ['Seattle Mariners'],
  SF: ['San Francisco Giants', 'SFG'], STL: ['St Louis Cardinals', 'St. Louis Cardinals'], TB: ['Tampa Bay Rays', 'TBR'],
  TEX: ['Texas Rangers'], TOR: ['Toronto Blue Jays'], WSH: ['Washington Nationals', 'WAS'],
}
const compact = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
const teamAliases = new Map(Object.entries(teams).flatMap(([code, aliases]) => [code, ...aliases].map(name => [compact(name), code] as const)))
function nameKey(value: string) { const parts = value.split(','); return compact(parts.length === 2 ? `${parts[1]} ${parts[0]}` : value) }
function roles(position: string | null): string[] {
  const positions = String(position ?? '').toUpperCase().split(/[,/\s]+/)
  if (positions.includes('TWP')) return ['pitcher', 'hitter']
  return [...new Set(positions.map(p => ['P', 'SP', 'RP'].includes(p) ? 'pitcher' : ['C','1B','2B','3B','SS','OF','LF','CF','RF','DH','UT','UTIL'].includes(p) ? 'hitter' : '').filter(Boolean))]
}

/** Exact normalized name + recognized current team + batting/pitching role; never a name-only guess. */
export function planMlbFantraxIdentityLinks(refs: FantraxPlayerRef[], identities: MlbIdentityRow[]) {
  const byName = new Map<string, MlbIdentityRow[]>()
  for (const row of identities) { const key = nameKey(row.canonicalName); byName.set(key, [...(byName.get(key) ?? []), row]) }
  const proposed: Array<{ id: string; fantraxId: string; rollingInsightsId: string }> = []
  const existingSourceIds = new Set(identities.map(row => row.fantraxId).filter(Boolean))
  let unmatched = 0, ambiguous = 0, unchanged = 0, conflicts = 0
  for (const ref of refs) {
    const sourceTeam = teamAliases.get(compact(ref.team ?? ''))
    const sourceRoles = roles(ref.position)
    if (!ref.fantraxId || !sourceTeam || !sourceRoles.length) { unmatched++; continue }
    const candidates = (byName.get(nameKey(ref.name)) ?? []).filter(row => row.rollingInsightsId && teamAliases.get(compact(row.currentTeam ?? '')) === sourceTeam && roles(row.position).some(role => sourceRoles.includes(role)))
    if (!candidates.length) { unmatched++; continue }
    if (candidates.length !== 1) { ambiguous++; continue }
    const row = candidates[0]!
    if (row.fantraxId === ref.fantraxId) { unchanged++; continue }
    if (row.fantraxId || existingSourceIds.has(ref.fantraxId)) { conflicts++; continue }
    proposed.push({ id: row.id, fantraxId: ref.fantraxId, rollingInsightsId: row.rollingInsightsId! })
  }
  const counts = new Map<string, number>()
  for (const link of proposed) { const key = link.rollingInsightsId; counts.set(key, (counts.get(key) ?? 0) + 1) }
  const links = proposed.filter(link => counts.get(link.rollingInsightsId) === 1)
  return { links, unmatched, ambiguous: ambiguous + proposed.length - links.length, unchanged, conflicts, provided: refs.length }
}
