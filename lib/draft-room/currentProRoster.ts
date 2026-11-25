import { canonicalName as normalizeMatchName } from './player-canonical-identity'
import { verifiedMediaAliasPeerId, verifiedMediaAliasMatches } from './verifiedMediaAliases'
import { providerPositionCode } from '@/lib/sports-data/providerPositionCode'

export type CurrentProRow = {
  externalId?: string; name: string; source: string; status: string | null; team: string | null; position: string | null
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
/**
 * Providers store one birthday a calendar day apart (a UTC/local conversion on one side): Rolling
 * Insights has Joel Embiid on 1994-03-15, Sleeper and TheSportsDB on 03-16. Measured 2026-11-25 on NBA:
 * 21 rostered players differ this way or worse, and the two who were also INACT (Embiid, McConnell)
 * could not be drafted. One day apart under the same name is the same person; more is a conflict.
 */
function sameBirthday(a: string, b: string): boolean {
  const [x, y] = [Date.parse(a.slice(0, 10)), Date.parse(b.slice(0, 10))]
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 86400000
}
/** A conflicting birthday never authorizes a photo or position change. Same names alone are insufficient. */
export function verifiedRosterMatch(a: CurrentProRow, b: CurrentProRow): boolean {
  if (!normalizeMatchName(a.name) || normalizeMatchName(a.name) !== normalizeMatchName(b.name)) return false
  if (a.dob && b.dob) return sameBirthday(a.dob, b.dob)
  return Boolean(team(a.team) && team(a.team) === team(b.team) && a.position && a.position === b.position)
}
/**
 * One player the two providers file under different names or birthdays, so the rule above can never
 * join them. Each entry was read off both stored rows (provider id, exact name, birthday, club) on the
 * date given. It counts only while both rows still read exactly this and name the same club, and it
 * is roster evidence like any other match: the secondary row must still say the player is rostered.
 */
const VERIFIED_ROSTER_ALIASES = [
  // 2026-11-25: Rolling Insights uses the formal first name.
  { sport: 'NBA', rollingId: '999', rollingName: 'Nicolas Claxton', rollingDob: '1999-04-17', secondaryId: 'tsdb_34196115', secondaryName: 'Nic Claxton', secondaryDob: '1999-04-17' },
  // 2026-11-25: Rolling Insights has the birthday a month early; Sleeper agrees with TheSportsDB.
  { sport: 'NBA', rollingId: '1912', rollingName: 'Sergio De Larrea', rollingDob: '2005-11-04', secondaryId: 'tsdb_34433756', secondaryName: 'Sergio de Larrea', secondaryDob: '2005-12-04' },
] as const
function verifiedRosterAliasPeerId(sport: string, row: CurrentProRow): string | null {
  if (row.source !== 'rolling_insights' || !row.externalId) return null
  const entry = VERIFIED_ROSTER_ALIASES.find((a) => a.sport === sport && a.rollingId === row.externalId)
  return entry && row.name === entry.rollingName && row.dob?.slice(0, 10) === entry.rollingDob ? entry.secondaryId : null
}
function verifiedRosterAliasMatches(sport: string, row: CurrentProRow, peer: CurrentProRow): boolean {
  const entry = VERIFIED_ROSTER_ALIASES.find((a) => a.sport === sport && a.rollingId === row.externalId)
  return Boolean(entry && verifiedRosterAliasPeerId(sport, row) === peer.externalId && peer.source === 'thesportsdb' &&
    peer.name === entry.secondaryName && peer.dob?.slice(0, 10) === entry.secondaryDob && team(row.team) && team(row.team) === team(peer.team))
}

/** Keep scoring IDs on the input row. Supplement only from one verified current roster identity. */
export function reconcileCurrentProRows<T extends CurrentProRow>(
  sport: string, rows: readonly T[], evidence: readonly T[], currentOnly: boolean, now = Date.now(),
): T[] {
  if (!['NFL', 'NBA', 'NHL', 'MLB'].includes(sport)) return [...rows]
  const byName = new Map<string, T[]>()
  const byExternalId = new Map<string, T>()
  for (const row of evidence) {
    if (!['thesportsdb', 'sleeper'].includes(row.source) || !fresh(row, now)) continue
    if (row.source === 'thesportsdb' && row.externalId) byExternalId.set(row.externalId, row)
    const key = normalizeMatchName(row.name)
    const bucket = byName.get(key) ?? []
    bucket.push(row); byName.set(key, bucket)
  }
  const hasSleeperRoster = sport === 'NFL' && evidence.some((row) => row.source === 'sleeper' && fresh(row, now))
  // Rolling Insights keeps more than one profile for some players, and only one of them is current.
  // Measured 2026-11-25 on NBA: Dyson Daniels is id 1431 (ACT, Hawks, in today's feed) and id 1432
  // (INACT, Pelicans, last returned 2026-10-23); Kevin Knox II is id 878 (in today's feed) and id 1952
  // (last returned 2026-10-19); Yanic Konan Niederhaeuser (ACT) is also "Niederhauser" (INACT). Other
  // providers confirm the PLAYER, so they confirm every profile of them alike, and the spare one would
  // sit in the pool as a second copy on an old club or on an id that receives no stats.
  const rollingByBirthday = new Map<string, T[]>()
  for (const row of rows) {
    if (row.source !== 'rolling_insights' || !row.dob) continue
    const key = row.dob.slice(0, 10)
    rollingByBirthday.set(key, [...(rollingByBirthday.get(key) ?? []), row])
  }
  const firstName = (row: CurrentProRow) => normalizeMatchName(row.name).split(' ')[0] ?? ''
  /** Another Rolling Insights profile of this same player is the current one. */
  const superseded = (row: T) => (rollingByBirthday.get(row.dob?.slice(0, 10) ?? '') ?? []).some((other) => other !== row && (
    normalizeMatchName(other.name) === normalizeMatchName(row.name)
      ? live(other, now) || (fresh(other, now) && !fresh(row, now))
      // A second spelling: the same birthday, club, position and first name, beside a live profile.
      : live(other, now) && team(other.team) === team(row.team) && other.position === row.position && firstName(other) === firstName(row)))
  const out: T[] = []
  for (const row of rows) {
    if (currentOnly && ['NBA', 'NHL', 'MLB'].includes(sport) && row.source !== 'rolling_insights') continue
    // A null Sleeper team is an authoritative free-agent/retired statement.
    if (currentOnly && hasSleeperRoster && (row.source !== 'sleeper' || !live(row, now))) continue
    if (currentOnly && row.source === 'rolling_insights' && !live(row, now) && superseded(row)) continue
    const matches = (byName.get(normalizeMatchName(row.name)) ?? []).filter((other) => verifiedRosterMatch(row, other))
    const rosterAliasPeerId = verifiedRosterAliasPeerId(sport, row)
    const rosterAliasPeer = rosterAliasPeerId ? byExternalId.get(rosterAliasPeerId) : undefined
    if (rosterAliasPeer && !matches.includes(rosterAliasPeer) && verifiedRosterAliasMatches(sport, row, rosterAliasPeer)) matches.push(rosterAliasPeer)
    const verified = matches.length === 1 ? matches[0] : undefined
    // Two providers confirming one player is agreement, not ambiguity: at most one match per source.
    // Two matches from ONE source are namesakes and prove nothing. Before, "exactly one match" meant
    // a second source arriving (Sleeper's NBA rows, 2026-11-03) dropped every rostered player RI
    // marks INACT from redraft pools: 125 of ~550 NBA players on 2026-11-25, among them Antetokounmpo,
    // Curry, Wembanyama and Edwards. Roster membership only: `verified` still needs a single match,
    // so a position or photo is never taken from one of two providers that may disagree.
    const agreed = new Set(matches.map((other) => other.source)).size === matches.length ? matches : []
    if (currentOnly && !live(row, now) && !agreed.some((other) => live(other, now))) continue
    const peerId = verifiedMediaAliasPeerId(sport, row)
    const peer = peerId ? byExternalId.get(peerId) : undefined
    const aliasPhoto = peer && verifiedMediaAliasMatches(sport, row, peer) ? peer.imageUrl : null
    // Media aliases never authorize a status/position/team change.
    if (sport === 'NFL' || row.source !== 'rolling_insights' || !verified) {
      out.push(!row.imageUrl && aliasPhoto ? { ...row, imageUrl: aliasPhoto } : row); continue
    }
    const explicitMlbRole = sport === 'MLB'
      ? ({ 'STARTING PITCHER': 'SP', 'RELIEF PITCHER': 'RP' } as Record<string, string>)[String(verified.position ?? '').trim().toUpperCase()]
      : undefined
    const position = explicitMlbRole ?? providerPositionCode(verified.position, sport)
    // Generic Forward/Guard/Winger labels cannot establish a fantasy lineup slot.
    const specific = position && ({
      NBA: ['PG', 'SG', 'SF', 'PF', 'C'], NHL: ['C', 'LW', 'RW', 'D', 'G'],
      MLB: ['P', 'SP', 'RP', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'TWP'],
    } as Record<string, string[]>)[sport]?.includes(position)
    out.push({ ...row, position: row.position === 'TWP' ? row.position : specific && live(verified, now) && team(row.team) === team(verified.team) ? position : row.position, imageUrl: row.imageUrl || verified.imageUrl || aliasPhoto || null })
  }
  return out
}
