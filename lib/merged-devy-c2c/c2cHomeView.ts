/**
 * Pure shaping for the C2C (Campus to Canton) league home (specialty handoff: c2c/C2CHome).
 * The summary route reads `DevyRights`, `DevyPlayer`, `C2CScoringLog` and the C2C standings; this
 * file only arranges those rows. No scoring rule lives here.
 */

export type C2CRightRow = {
  id: string
  devyPlayerId: string
  state: string
  c2cLineupRole?: string | null
}

export type C2CPlayerRow = {
  id: string
  name: string
  position: string
  school: string
  classYear?: number | null
  draftEligibleYear?: number | null
}

export type C2CScoreRow = { devyPlayerId: string; season: number; week: number; points: number }

export type C2CCampusStarter = {
  rightsId: string
  name: string
  position: string
  school: string
  /** Points in the latest scored week for this player this season; null when nothing is logged. */
  points: number | null
  week: number | null
}

const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX']

/** A rights row the lineup sync marked as a starter (same predicate as lib/data/league-home.ts). */
export function isCampusStarter(r: Pick<C2CRightRow, 'c2cLineupRole' | 'state'>): boolean {
  return r.c2cLineupRole === 'STARTER' || r.state === 'COLLEGE_STARTER'
}

export function buildCampusLineup(
  rights: C2CRightRow[],
  players: C2CPlayerRow[],
  scores: C2CScoreRow[],
  season: number,
): { starters: C2CCampusStarter[]; latestWeek: number | null; total: number | null } {
  const byId = new Map(players.map((p) => [p.id, p]))
  // Latest week per player this season, summing multiple game rows in that week.
  const latest = new Map<string, { week: number; points: number }>()
  for (const s of scores) {
    if (s.season !== season) continue
    const cur = latest.get(s.devyPlayerId)
    if (!cur || s.week > cur.week) latest.set(s.devyPlayerId, { week: s.week, points: s.points })
    else if (s.week === cur.week) cur.points += s.points
  }
  const starters: C2CCampusStarter[] = []
  for (const r of rights) {
    if (!isCampusStarter(r)) continue
    const p = byId.get(r.devyPlayerId)
    if (!p) continue
    const l = latest.get(r.devyPlayerId)
    starters.push({
      rightsId: r.id,
      name: p.name,
      position: p.position,
      school: p.school,
      points: l ? Math.round(l.points * 10) / 10 : null,
      week: l?.week ?? null,
    })
  }
  starters.sort((a, b) => {
    const ia = POS_ORDER.indexOf(a.position.toUpperCase())
    const ib = POS_ORDER.indexOf(b.position.toUpperCase())
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || (b.points ?? -1) - (a.points ?? -1)
  })
  const weeks = starters.map((s) => s.week).filter((w): w is number => w != null)
  const latestWeek = weeks.length ? Math.max(...weeks) : null
  const inLatest = starters.filter((s) => s.week === latestWeek && s.points != null)
  const total = latestWeek == null ? null : Math.round(inLatest.reduce((a, s) => a + (s.points ?? 0), 0) * 10) / 10
  return { starters, latestWeek, total }
}

/** Share of the combined score that came from campus, 0–1. Null when there is nothing to divide. */
export function campusShare(collegePoints: number, proPoints: number): number | null {
  const c = Math.max(0, collegePoints)
  const p = Math.max(0, proPoints)
  if (c + p <= 0) return null
  return c / (c + p)
}

export type C2CGraduatingItem = { rightsId: string; name: string; position: string; status: string }

const LEAVING: Record<string, string> = {
  DECLARED: 'Declared',
  DRAFTED_RIGHTS_HELD: 'Drafted',
  PROMOTION_ELIGIBLE: 'Ready to graduate',
}

/**
 * College rights graduating soon: declared / drafted / promotion-eligible first, then players whose
 * draft-eligible year is next spring. Class labels come from the player row, never guessed.
 */
export function graduatingRights(rights: C2CRightRow[], players: C2CPlayerRow[], seasonYear: number): C2CGraduatingItem[] {
  const byId = new Map(players.map((p) => [p.id, p]))
  const out: (C2CGraduatingItem & { order: number })[] = []
  for (const r of rights) {
    const p = byId.get(r.devyPlayerId)
    if (!p) continue
    if (LEAVING[r.state]) {
      out.push({ rightsId: r.id, name: p.name, position: p.position, status: LEAVING[r.state], order: 0 })
    } else if (r.state !== 'PROMOTED_TO_PRO' && r.state !== 'RIGHTS_EXPIRED' && p.draftEligibleYear != null && p.draftEligibleYear <= seasonYear + 1) {
      out.push({ rightsId: r.id, name: p.name, position: p.position, status: `Draft-eligible ${p.draftEligibleYear}`, order: 1 })
    }
  }
  return out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)).map(({ order: _o, ...rest }) => rest)
}
