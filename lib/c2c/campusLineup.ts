/**
 * The CAMPUS lineup of a native C2C (Campus to Canton) league: the college players a team starts each
 * week, scored on top of its pro lineup (lib/c2c/campusScoring.ts).
 *
 * Stored in the roster's own lineup as `lineup_sections.campus` (Roster.playerData): a list of player ids
 * MARKING which of the team's devy players start on campus this week. A campus starter stays in the `devy`
 * section, so to every generic reader (pro scoring, roster limits, the lineup screens and the 30-odd
 * slot readers) he is still a devy player; only the C2C scorer adds him.
 *
 * Football (NFL C2C, scored from college weeks) and basketball (NBA C2C, scored from the college games
 * inside the NBA week's dates). Pure — no database access.
 */
import type { C2CLineupSlots } from '@/lib/merged-devy-c2c/types'

export const CAMPUS_SECTION = 'campus'

/** Native C2C variants. The legacy `C2CLeague` engine (imported leagues) has its own scorer. */
const C2C_VARIANTS = new Set(['c2c', 'merged_devy_c2c'])

export function isC2CVariant(leagueVariant: string | null | undefined): boolean {
  return C2C_VARIANTS.has(String(leagueVariant ?? '').toLowerCase())
}

export function isFootballC2CLeague(league: { leagueVariant?: string | null; sport?: string | null }): boolean {
  return campusSport(league) === 'football'
}

export function isBasketballC2CLeague(league: { leagueVariant?: string | null; sport?: string | null }): boolean {
  return campusSport(league) === 'basketball'
}

export type CampusSport = 'football' | 'basketball'

/** Which college sport a native C2C league's campus lineup plays: NFL → football, NBA → basketball. */
export function campusSport(league: { leagueVariant?: string | null; sport?: string | null }): CampusSport | null {
  if (!isC2CVariant(league.leagueVariant)) return null
  const sport = String(league.sport ?? '').toUpperCase()
  return sport === 'NFL' ? 'football' : sport === 'NBA' ? 'basketball' : null
}

const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const idOf = (e: unknown): string => (typeof e === 'string' ? e : String(record(e).id ?? record(e).player_id ?? ''))

function sectionIds(playerData: unknown, name: string): string[] {
  const sections = record(record(playerData).lineup_sections)
  const list = sections[name]
  return Array.isArray(list) ? [...new Set(list.map(idOf).filter(Boolean))] : []
}

/** The team's campus starters, in saved order. */
export function campusStarterIds(playerData: unknown): string[] {
  return sectionIds(playerData, CAMPUS_SECTION)
}

/** The team's college players: its devy section. */
export function collegePlayerIds(playerData: unknown): Set<string> {
  return new Set(sectionIds(playerData, 'devy'))
}

/**
 * The campus starters a lineup save stores: the list it sent, or (a save from any other screen) the saved
 * list, keeping only players still in the save's devy section — so a pro lineup change never wipes the
 * campus lineup, and a player promoted, cut or traded leaves it.
 */
export function campusStartersAfterSave(input: { saved: unknown; sent?: unknown[]; devyIds: readonly string[] }): string[] {
  const devy = new Set(input.devyIds)
  const ids = input.sent ? [...new Set(input.sent.map(idOf).filter(Boolean))] : campusStarterIds(input.saved)
  return ids.filter((id) => devy.has(id))
}

/** Which campus slot keys a football position may fill. */
const FOOTBALL_SLOT_POSITIONS: Record<string, readonly string[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  FLEX: ['RB', 'WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  SUPERFLEX: ['QB', 'RB', 'WR', 'TE'],
}

/**
 * Which campus slot keys a basketball position may fill. A college box lists PG/SG/SF/PF/C or the
 * combined G, F, G-F and F-C; the NBA C2C college slots are G, F, C and FLEX (any position) — the
 * mapping the C2C best-ball optimizer uses, with a combined position eligible for both halves.
 */
const BASKETBALL_SLOT_POSITIONS: Record<string, readonly string[]> = {
  G: ['PG', 'SG', 'G', 'G-F'],
  F: ['SF', 'PF', 'F', 'G-F', 'F-C'],
  C: ['C', 'F-C'],
  FLEX: ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'G-F', 'F-C'],
  UTIL: ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'G-F', 'F-C'],
}

/** The configured campus slots, one entry per seat (`{ QB: 1, FLEX: 2 }` → QB, FLEX, FLEX). */
export function campusSeats(slots: C2CLineupSlots | null | undefined): string[] {
  const out: string[] = []
  for (const [key, n] of Object.entries(slots ?? {})) {
    const count = Number(n)
    if (!Number.isInteger(count) || count <= 0) continue
    for (let i = 0; i < count; i++) out.push(key.toUpperCase())
  }
  return out
}

function canFill(seat: string, position: string | null | undefined, sport: CampusSport): boolean {
  const pos = String(position ?? '').toUpperCase()
  const table = sport === 'basketball' ? BASKETBALL_SLOT_POSITIONS : FOOTBALL_SLOT_POSITIONS
  return (table[seat] ?? [seat]).includes(pos)
}

/**
 * Can these players all be seated in the campus slots at once? A bipartite matching (a few players,
 * a few seats), so a WR in FLEX never blocks a later RB that only FLEX could take.
 */
export function seatCampusPlayers(
  seats: readonly string[],
  positions: ReadonlyArray<string | null | undefined>,
  sport: CampusSport = 'football',
): boolean {
  if (positions.length > seats.length) return false
  const seatOf: number[] = new Array(seats.length).fill(-1)
  const tryPlace = (p: number, seen: boolean[]): boolean => {
    for (let s = 0; s < seats.length; s++) {
      if (seen[s] || !canFill(seats[s], positions[p], sport)) continue
      seen[s] = true
      if (seatOf[s] === -1 || tryPlace(seatOf[s], seen)) {
        seatOf[s] = p
        return true
      }
    }
    return false
  }
  return positions.every((_, p) => tryPlace(p, new Array(seats.length).fill(false)))
}

export type CampusLineupIssue = {
  code: 'campus_not_c2c' | 'campus_not_football' | 'campus_not_college' | 'campus_too_many' | 'campus_ineligible'
  message: string
}

/**
 * A saved campus lineup is legal when every campus starter was already one of the team's college players
 * (devy, before the save — a lineup save never adds a player — and still devy after it), there are no more of them than campus
 * seats, and they can all be seated.
 */
export function validateCampusLineup(input: {
  before: unknown
  after: unknown
  slots: C2CLineupSlots | null | undefined
  positionOf: (playerId: string) => string | null | undefined
  /** The league's campus sport (`campusSport`); null for a C2C league in a sport with no campus scoring. */
  sport: CampusSport | null
  nameOf?: (playerId: string) => string
}): CampusLineupIssue[] {
  const campus = campusStarterIds(input.after)
  if (campus.length === 0) return []
  if (!input.sport) {
    return [{ code: 'campus_not_football', message: 'Campus lineups are scored for college football and college basketball only.' }]
  }
  const name = (id: string) => input.nameOf?.(id) || id
  const before = collegePlayerIds(input.before)
  const after = collegePlayerIds(input.after)
  const outsiders = campus.filter((id) => !before.has(id) || !after.has(id))
  if (outsiders.length) {
    return [{ code: 'campus_not_college', message: `Only your college players can start on campus: ${outsiders.map(name).join(', ')}.` }]
  }
  const seats = campusSeats(input.slots)
  if (campus.length > seats.length) {
    return [{ code: 'campus_too_many', message: `Your league starts ${seats.length} college players; this lineup has ${campus.length}.` }]
  }
  if (!seatCampusPlayers(seats, campus.map(input.positionOf), input.sport)) {
    return [{ code: 'campus_ineligible', message: `These college players do not fit your campus slots (${seats.join(', ')}).` }]
  }
  return []
}

export type CampusToggle = { playerId: string; onCampus: boolean; canStart: boolean }

/**
 * The panel's buttons: for each college player, whether he is on campus and whether he could be
 * started now (a free seat he can fill, with everyone already on campus still seated).
 */
export function campusToggles(
  seats: readonly string[],
  starterIds: readonly string[],
  players: ReadonlyArray<{ id: string; position: string | null | undefined }>,
  sport: CampusSport = 'football',
): CampusToggle[] {
  const positionOf = new Map(players.map((p) => [p.id, p.position]))
  const on = new Set(starterIds)
  const current = starterIds.map((id) => positionOf.get(id))
  return players.map((p) => ({
    playerId: p.id,
    onCampus: on.has(p.id),
    canStart: on.has(p.id) || seatCampusPlayers(seats, [...current, p.position], sport),
  }))
}
