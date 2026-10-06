import { normalizePlayerName } from '@/lib/team-abbrev'
import { cfbdScheduleTeamKeys } from '@/lib/sports-data/collegeTeamNames'
import type { NcaafIdentityRow } from './ncaafFantraxIdentityPlan'

/** Reviewed against LSU and William & Mary official 2026 rosters (2026-10-06).
 * docs/readiness/cream-bowl-scoring-fixes-2026-10-06.md contains the citations.
 * This is a repair proof, never a fallback name matcher.
 */
export const WINSTON_WATKINS_PROOF = {
  fantraxId: '06u8g', name: 'Winston Watkins Jr.', position: 'WR', school: 'LSU',
  cfbdId: '5141697', knownWrongCfbdId: '5226917', season: 2026,
} as const

type Source = { fantraxId?: string; name?: string; primaryPosition?: string; team?: string }
type Provider = { id: string | number; fullName: string; position: string; team: string }
const nameKey = (name: string) => {
  const parts = name.split(',')
  return normalizePlayerName(parts.length === 2 ? `${parts[1]} ${parts[0]}` : name)
}
const schoolKey = (name: string | null) => cfbdScheduleTeamKeys(name).exact

export function planWinstonWatkinsRepair(source: Source[], identities: NcaafIdentityRow[], provider: Provider[]) {
  const p = WINSTON_WATKINS_PROOF
  const supplied = source.filter(r => r.fantraxId === p.fantraxId)
  if (supplied.length !== 1 || nameKey(supplied[0]!.name ?? '') !== nameKey(p.name) || supplied[0]!.primaryPosition !== p.position || schoolKey(supplied[0]!.team ?? null) !== schoolKey(p.school)) {
    throw new Error('Winston source roster proof failed')
  }
  const candidates = provider.filter(r => String(r.id) === p.cfbdId && nameKey(r.fullName) === nameKey(p.name) && r.position === p.position && schoolKey(r.team) === schoolKey(p.school))
  if (candidates.length !== 1) throw new Error('Winston provider proof failed')
  const owners = identities.filter(r => r.fantraxId === p.fantraxId)
  if (owners.length !== 1) throw new Error('Winston source identity must have one owner')
  const row = owners[0]!
  if (nameKey(row.canonicalName) !== nameKey(p.name) || row.position !== p.position || schoolKey(row.currentTeam) !== schoolKey(p.school)) {
    throw new Error('Winston identity metadata proof failed')
  }
  if (row.cfbdId !== p.cfbdId && row.cfbdId !== p.knownWrongCfbdId) throw new Error('Unexpected existing Winston provider link')
  if (identities.some(r => r.cfbdId === p.cfbdId && r.fantraxId && r.fantraxId !== p.fantraxId)) throw new Error('Winston reverse provider ownership conflict')
  return { row, changed: row.cfbdId !== p.cfbdId, cfbdId: p.cfbdId }
}
