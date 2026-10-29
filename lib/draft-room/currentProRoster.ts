import { canonicalName as normalizeMatchName } from './player-canonical-identity'
import { providerPositionCode } from '@/lib/sports-data/providerPositionCode'

export type CurrentProRow = {
  name: string; source: string; status: string | null; team: string | null; position: string | null
  dob?: string | null; imageUrl?: string | null; fetchedAt?: Date | string; expiresAt?: Date | string
}
const date = (value: Date | string | undefined) => value == null ? NaN : new Date(value).getTime()
const team = (value: string | null) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const status = (row: CurrentProRow) => String(row.status ?? '').trim().toUpperCase()
function fresh(row: CurrentProRow, now: number) {
  return date(row.fetchedAt) >= now - 72 * 60 * 60 * 1000 && date(row.expiresAt) > now
}
function live(row: CurrentProRow, now: number) {
  if (!fresh(row, now) || !team(row.team) || ['FA', 'FREEAGENT', 'NONE'].includes(team(row.team).toUpperCase())) return false
  if (row.source === 'rolling_insights') return ['ACT', 'QUES'].includes(status(row))
  // Sleeper's team is authoritative. Inactive can describe a rostered injured player.
  // Null teams were rejected above; never restore a free agent's previous club.
  if (row.source === 'sleeper') return !['RETIRED', 'FREE AGENT', 'FREEAGENT', 'COACHING'].includes(status(row))
  return ['ACTIVE', 'INJURED RESERVE', 'INJUREDRESERVE', 'INJURED', 'OUT', 'QUESTIONABLE', 'IR', 'IL', 'DTD'].includes(status(row))
}
/** A conflicting birthday never authorizes a photo or position change. Same names alone are insufficient. */
export function verifiedRosterMatch(a: CurrentProRow, b: CurrentProRow): boolean {
  if (!normalizeMatchName(a.name) || normalizeMatchName(a.name) !== normalizeMatchName(b.name)) return false
  if (a.dob && b.dob) return a.dob.slice(0, 10) === b.dob.slice(0, 10)
  return Boolean(team(a.team) && team(a.team) === team(b.team) && a.position && a.position === b.position)
}

/** Keep scoring IDs on the input row. Supplement only from one verified current roster identity. */
export function reconcileCurrentProRows<T extends CurrentProRow>(
  sport: string, rows: readonly T[], evidence: readonly T[], currentOnly: boolean, now = Date.now(),
): T[] {
  if (!['NFL', 'NBA', 'NHL', 'MLB'].includes(sport)) return [...rows]
  const byName = new Map<string, T[]>()
  for (const row of evidence) {
    if (!['thesportsdb', 'sleeper'].includes(row.source) || !fresh(row, now)) continue
    const key = normalizeMatchName(row.name)
    const bucket = byName.get(key) ?? []
    bucket.push(row); byName.set(key, bucket)
  }
  const hasSleeperRoster = sport === 'NFL' && evidence.some((row) => row.source === 'sleeper' && fresh(row, now))
  const out: T[] = []
  for (const row of rows) {
    if (currentOnly && ['NBA', 'NHL', 'MLB'].includes(sport) && row.source !== 'rolling_insights') continue
    // A null Sleeper team is an authoritative free-agent/retired statement.
    if (currentOnly && hasSleeperRoster && (row.source !== 'sleeper' || !live(row, now))) continue
    const matches = (byName.get(normalizeMatchName(row.name)) ?? []).filter((other) => verifiedRosterMatch(row, other))
    const verified = matches.length === 1 ? matches[0] : undefined
    if (currentOnly && !live(row, now) && !(verified && live(verified, now))) continue
    if (sport === 'NFL' || row.source !== 'rolling_insights' || !verified) { out.push(row); continue }
    const position = providerPositionCode(verified.position, sport)
    // Generic Forward/Guard/Winger labels cannot establish a fantasy lineup slot.
    const specific = position && ({
      NBA: ['PG', 'SG', 'SF', 'PF', 'C'], NHL: ['C', 'LW', 'RW', 'D', 'G'],
      MLB: ['P', 'SP', 'RP', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'TWP'],
    } as Record<string, string[]>)[sport]?.includes(position)
    out.push({ ...row, position: row.position === 'TWP' ? row.position : specific && live(verified, now) ? position : row.position, imageUrl: row.imageUrl || verified.imageUrl || null })
  }
  return out
}
