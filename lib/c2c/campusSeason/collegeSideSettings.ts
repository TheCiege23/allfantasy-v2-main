/**
 * The commissioner's college-side settings for an NFL C2C or devy league (2026-11-24):
 *  - devy only: college scoring on or off, and the college lineup seats;
 *  - both: college regular-season weeks and college playoff teams.
 *
 * All in League.settings (no schema change). Pure: reading, validating, and merging.
 *
 * When an edit may happen: the season shape (weeks, playoff teams) is fixed when the college season is
 * created (its schedule is built from it), so it can change only before then. Devy college scoring can
 * be turned on at any time; a season turned on late starts with the next college week (runCampusSeason).
 */
import {
  CAMPUS_PLAYOFF_TEAMS_KEY,
  CAMPUS_REGULAR_WEEKS_KEY,
  DEFAULT_CAMPUS_PLAYOFF_TEAMS,
  DEFAULT_CAMPUS_REGULAR_WEEKS,
} from './campusSeasonRules'
import { DEVY_COLLEGE_LINEUP_KEY, DEVY_COLLEGE_SCORING_KEY, devyCollegeLineupSlots } from '../collegeLineupLeague'
import type { C2CLineupSlots } from '@/lib/merged-devy-c2c/types'

export type CollegeSideKind = 'c2c' | 'devy'

export type CollegeSideSettings = {
  kind: CollegeSideKind
  /** Devy: whether the college lineup scores. Always true for C2C. */
  collegeScoring: boolean
  /** Devy seats (C2C seats are edited in the C2C panel). */
  lineupSlots: C2CLineupSlots | null
  regularSeasonWeeks: number
  playoffTeams: number
}

export const MAX_COLLEGE_REGULAR_WEEKS = 14
/** Seats a devy college lineup may use, and how many of each. */
export const DEVY_SEAT_KEYS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX'] as const
const MAX_PER_SEAT = 4
const MAX_SEATS = 12

const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null)

export function readCollegeSideSettings(settings: unknown, kind: CollegeSideKind): CollegeSideSettings {
  const s = record(settings)
  return {
    kind,
    collegeScoring: kind === 'c2c' ? true : s[DEVY_COLLEGE_SCORING_KEY] === true,
    lineupSlots: kind === 'devy' ? devyCollegeLineupSlots(settings) : null,
    regularSeasonWeeks: int(s[CAMPUS_REGULAR_WEEKS_KEY]) ?? DEFAULT_CAMPUS_REGULAR_WEEKS,
    playoffTeams: int(s[CAMPUS_PLAYOFF_TEAMS_KEY]) ?? DEFAULT_CAMPUS_PLAYOFF_TEAMS,
  }
}

export type CollegeSidePatch = { collegeScoring?: unknown; lineupSlots?: unknown; regularSeasonWeeks?: unknown; playoffTeams?: unknown }

export type CollegeSidePatchResult =
  | { ok: true; settingsPatch: Record<string, unknown> }
  | { ok: false; status: 400 | 409; error: string; field: string }

/**
 * Validate an edit and turn it into League.settings keys. `seasonCreated`: the college season for this
 * year already exists, so its shape is fixed.
 */
export function planCollegeSidePatch(input: { kind: CollegeSideKind; teamCount: number; seasonCreated: boolean; patch: CollegeSidePatch }): CollegeSidePatchResult {
  const { patch } = input
  const out: Record<string, unknown> = {}

  if (patch.collegeScoring !== undefined) {
    if (input.kind !== 'devy') return { ok: false, status: 400, error: 'A C2C league’s college lineup always scores.', field: 'collegeScoring' }
    if (typeof patch.collegeScoring !== 'boolean') return { ok: false, status: 400, error: 'College scoring must be on or off.', field: 'collegeScoring' }
    out[DEVY_COLLEGE_SCORING_KEY] = patch.collegeScoring
  }

  if (patch.lineupSlots !== undefined) {
    if (input.kind !== 'devy') return { ok: false, status: 400, error: 'Change a C2C league’s college lineup in the C2C settings.', field: 'lineupSlots' }
    const raw = record(patch.lineupSlots)
    const slots: C2CLineupSlots = {}
    for (const [k, v] of Object.entries(raw)) {
      const key = k.toUpperCase()
      if (!(DEVY_SEAT_KEYS as readonly string[]).includes(key)) return { ok: false, status: 400, error: `${k} is not a college lineup seat.`, field: 'lineupSlots' }
      const n = int(v)
      if (n == null || n < 0 || n > MAX_PER_SEAT) return { ok: false, status: 400, error: `${key} takes 0 to ${MAX_PER_SEAT} players.`, field: 'lineupSlots' }
      if (n > 0) slots[key] = n
    }
    const total = Object.values(slots).reduce((a, b) => a + b, 0)
    if (total < 1 || total > MAX_SEATS) return { ok: false, status: 400, error: `A college lineup has 1 to ${MAX_SEATS} starters.`, field: 'lineupSlots' }
    out[DEVY_COLLEGE_LINEUP_KEY] = slots
  }

  const shapeEdit = patch.regularSeasonWeeks !== undefined || patch.playoffTeams !== undefined
  if (shapeEdit && input.seasonCreated) {
    return { ok: false, status: 409, error: 'This year’s college schedule is already set. Season length and playoff size apply from next season.', field: patch.regularSeasonWeeks !== undefined ? 'regularSeasonWeeks' : 'playoffTeams' }
  }
  if (patch.regularSeasonWeeks !== undefined) {
    const n = int(patch.regularSeasonWeeks)
    if (n == null || n < 1 || n > MAX_COLLEGE_REGULAR_WEEKS) return { ok: false, status: 400, error: `The college regular season is 1 to ${MAX_COLLEGE_REGULAR_WEEKS} weeks.`, field: 'regularSeasonWeeks' }
    out[CAMPUS_REGULAR_WEEKS_KEY] = n
  }
  if (patch.playoffTeams !== undefined) {
    const n = int(patch.playoffTeams)
    const max = Math.min(32, input.teamCount)
    if (n == null || n < 0 || n === 1 || n > max) return { ok: false, status: 400, error: `College playoff teams: none, or 2 to ${max}.`, field: 'playoffTeams' }
    out[CAMPUS_PLAYOFF_TEAMS_KEY] = n
  }

  if (Object.keys(out).length === 0) return { ok: false, status: 400, error: 'Nothing to change.', field: '' }
  return { ok: true, settingsPatch: out }
}
