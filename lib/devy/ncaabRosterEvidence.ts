import { ESPN_NCAAB_ROSTER_KEY_PREFIX, currentNcaabSeasonYear, type EspnNcaabRosterSnapshot } from '@/lib/espn/ncaabRosterSnapshot'

const FRESH_MS = 14 * 24 * 60 * 60 * 1000
export const ESPN_NCAAB_DEVY_ID_PREFIX = 'espn:ncaab:'
export type RosterEvidenceRow = { cacheKey: string; data: unknown; expiresAt: Date }
export type CurrentCollegeAthlete = { id: string; espnId: string; name: string; school: string; position: string; jersey: string | null; observedAt: Date }

/** Provider ID is namespaced, stable across transfers, and distinguishable from RI and NFL IDs. */
export function espnNcaabDevyId(espnId: string): string { return `${ESPN_NCAAB_DEVY_ID_PREFIX}${espnId}` }

/** Only fresh, current-season school snapshots can supply draft candidates. Refuse a player
 * observed on multiple schools until a refresh resolves the transfer; never guess which team won. */
export function selectCurrentNcaabAthletes(rows: readonly RosterEvidenceRow[], now: Date): { athletes: CurrentCollegeAthlete[]; ambiguous: string[] } {
  const seasonYear = currentNcaabSeasonYear(now)
  const candidates = new Map<string, CurrentCollegeAthlete[]>()
  for (const row of rows) {
    if (!row.cacheKey.startsWith(`${ESPN_NCAAB_ROSTER_KEY_PREFIX}${seasonYear}:`) || row.expiresAt.getTime() <= now.getTime()) continue
    if (!row.data || typeof row.data !== 'object' || Array.isArray(row.data)) continue
    const snapshot = row.data as Partial<EspnNcaabRosterSnapshot>
    if (snapshot.seasonYear !== seasonYear || typeof snapshot.school !== 'string' || !snapshot.school.trim() || typeof snapshot.teamId !== 'string' || !/^\d+$/.test(snapshot.teamId) || row.cacheKey !== `${ESPN_NCAAB_ROSTER_KEY_PREFIX}${seasonYear}:${snapshot.teamId}` || !Array.isArray(snapshot.athletes)) continue
    const observedAt = new Date(snapshot.observedAt ?? '')
    const age = now.getTime() - observedAt.getTime()
    if (!Number.isFinite(age) || age < 0 || age > FRESH_MS) continue
    for (const athlete of snapshot.athletes) {
      const id = typeof athlete?.id === 'string' ? athlete.id : ''
      const name = typeof athlete?.fullName === 'string' ? athlete.fullName.trim() : ''
      const position = typeof athlete?.position === 'string' ? athlete.position.trim().toUpperCase() : ''
      if (!/^\d+$/.test(id) || !name || !['G', 'F', 'C', 'PG', 'SG', 'SF', 'PF'].includes(position)) continue
      const item = { id: espnNcaabDevyId(id), espnId: id, name, school: snapshot.school.trim(), position, jersey: typeof athlete.jersey === 'string' ? athlete.jersey : null, observedAt }
      candidates.set(id, [...(candidates.get(id) ?? []), item])
    }
  }
  const athletes: CurrentCollegeAthlete[] = []
  const ambiguous: string[] = []
  for (const [espnId, items] of candidates) {
    if (items.length !== 1) { ambiguous.push(espnId); continue }
    athletes.push(items[0]!)
  }
  return { athletes, ambiguous }
}
