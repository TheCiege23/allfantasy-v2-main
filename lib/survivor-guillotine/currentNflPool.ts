import 'server-only'
import { prisma } from '@/lib/prisma'
import { canonicalName, canonicalPosition } from '@/lib/draft-room/player-canonical-identity'
import { normalizeNflTeam } from '@/lib/redraft/lineupLock'
import type { DraftPoolRawRow } from '@/lib/draft-room/getResolvedDraftPoolForLeague'
import type { NormalizedDraftEntry } from '@/lib/draft-asset-pipeline'

type Profile = { name: string; position: string | null; team: string | null; status: string | null; externalId: string; sleeperId: string | null; source: string }
const key = (name: string, position: string | null | undefined) => canonicalName(name) + '|' + canonicalPosition(position ?? '')
const clubs = new Set('ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS'.split(' '))

/** Require agreement about a current player across independently namespaced catalogs. */
export function verifiedCurrentSGNflRows(raw: DraftPoolRawRow[], profiles: Profile[]): DraftPoolRawRow[] {
  const sleepers = new Map<string, Profile>()
  for (const p of profiles.filter(p => p.source === 'sleeper')) {
    const id = p.sleeperId ?? p.externalId.replace(/^sleeper[:_]/, '')
    if (!sleepers.has(id) || p.externalId === 'sleeper:' + id) sleepers.set(id, p)
  }
  const names = new Map<string, Array<[string, Profile]>>()
  for (const item of sleepers) { const k = key(item[1].name, item[1].position); names.set(k, [...(names.get(k) ?? []), item]) }
  const enriched = new Map(raw.map(row => [key(row.name ?? row.playerName ?? row.full_name ?? '', row.position ?? row.pos), row]))
  const out = new Map<string, DraftPoolRawRow>()
  for (const ri of profiles.filter(p => p.source === 'rolling_insights' && p.status?.toUpperCase() === 'ACT')) {
    const matches = names.get(key(ri.name, ri.position)) ?? [], team = normalizeNflTeam(ri.team)
    if (matches.length !== 1 || !clubs.has(team)) continue
    const [id, p] = matches[0]
    if (!/^\d+$/.test(id) || ['INACTIVE', 'INACT', 'RETIRED', 'RET'].includes((p.status ?? '').toUpperCase())) continue
    const position = canonicalPosition(p.position ?? '')
    out.set(id, { ...enriched.get(key(p.name, position)), name: p.name, playerName: p.name, full_name: p.name, position, pos: position,
      team, teamAbbr: team, playerId: id, id, sleeperId: id, sourcePlayerId: id, sourceSleeperId: id, status: 'Active', isDevy: false })
  }
  for (const [id, p] of sleepers) {
    const team = normalizeNflTeam(p.team ?? id)
    if (!['DEF', 'DST'].includes(canonicalPosition(p.position ?? '')) || !clubs.has(team)) continue
    out.set('nfl:def:' + team, { name: p.name, position: 'DEF', team, playerId: 'nfl:def:' + team, id: 'nfl:def:' + team, status: 'Active' })
  }
  return [...out.values()]
}

export async function currentSGNflPool(raw: DraftPoolRawRow[]) {
  const profiles = await prisma.sportsPlayer.findMany({ where: { sport: 'NFL', source: { in: ['sleeper', 'rolling_insights'] }, fetchedAt: { gte: new Date(Date.now() - 48 * 3600000) } },
    select: { name: true, position: true, team: true, status: true, externalId: true, sleeperId: true, source: true }, orderBy: { fetchedAt: 'desc' } })
  return verifiedCurrentSGNflRows(raw, profiles)
}

/** Enrichment may reconcile provider IDs; restore the independently verified scoring identity. */
export function enforceCurrentSGNflEntries(entries: NormalizedDraftEntry[], current: DraftPoolRawRow[]) {
  const identities = new Map(current.map(row => [key(row.name ?? '', row.position), row]))
  return entries.flatMap(entry => {
    const p = identities.get(key(entry.name, entry.position))
    if (!p?.playerId) return []
    return [{ ...entry, playerId: p.playerId, name: p.name!, position: p.position!, team: p.team ?? null,
      display: { ...entry.display, playerId: p.playerId, displayName: p.name! } }]
  })
}
