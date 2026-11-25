/**
 * Which leagues have a SCORING college lineup, and its seats (owner's decision, 2026-11-24: "Devy works
 * the same way as C2C").
 *
 *  - Native C2C (NFL or NBA): always, seats from `C2CLeagueConfig.collegeActiveLineupSlots`.
 *  - Native NFL devy: when the league has `settings.devy_college_scoring` on. New devy leagues start
 *    with it on; a league that predates it keeps its stash-only devy until the commissioner turns it on.
 *    Seats from `settings.devy_college_lineup_slots`, default QB, RB, WR, WR, TE, FLEX.
 *
 * A devy league's college lineup always plays its own college season (lib/c2c/campusSeason), never
 * added to the pro score: the pro scorer keeps `campusSport` (C2C only) for that reason.
 */
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import type { C2CLineupSlots } from '@/lib/merged-devy-c2c/types'
import { campusSport, type CampusSport } from './campusLineup'

export const DEVY_COLLEGE_SCORING_KEY = 'devy_college_scoring'
export const DEVY_COLLEGE_LINEUP_KEY = 'devy_college_lineup_slots'
export const DEVY_COLLEGE_LINEUP_DEFAULT: C2CLineupSlots = { QB: 1, RB: 1, WR: 2, TE: 1, FLEX: 1 }

const DEVY_VARIANTS = new Set(['devy', 'devy_dynasty'])

type LeagueLike = { leagueVariant?: string | null; leagueType?: string | null; sport?: string | null; platform?: string | null; settings?: unknown }

const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

export function isDevyVariant(leagueVariant: string | null | undefined): boolean {
  return DEVY_VARIANTS.has(String(leagueVariant ?? '').trim().toLowerCase())
}

/** A native NFL devy league whose college lineup scores. */
export function isScoringDevyLeague(league: LeagueLike): boolean {
  // The create wizard stores a devy league as `leagueType: 'devy'` with no variant (see campusSport).
  if (!isDevyVariant(league.leagueVariant) && String(league.leagueType ?? '').trim().toLowerCase() !== 'devy') return false
  if (String(league.sport ?? '').toUpperCase() !== 'NFL') return false
  if (league.platform !== undefined && !isNativePlatform(league.platform ?? null)) return false
  return record(league.settings)[DEVY_COLLEGE_SCORING_KEY] === true
}

/** The college sport a league's scoring college lineup plays, or null when it has none. */
export function collegeLineupSport(league: LeagueLike): CampusSport | null {
  const c2c = campusSport({ leagueVariant: league.leagueVariant ?? null, sport: league.sport ?? null, leagueType: league.leagueType ?? null })
  if (c2c) return c2c
  return isScoringDevyLeague(league) ? 'football' : null
}

/** A devy league's college seats from its settings, or the default. */
export function devyCollegeLineupSlots(settings: unknown): C2CLineupSlots {
  const raw = record(record(settings)[DEVY_COLLEGE_LINEUP_KEY])
  const out: C2CLineupSlots = {}
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10) out[k.toUpperCase()] = v
  return Object.keys(out).length ? out : { ...DEVY_COLLEGE_LINEUP_DEFAULT }
}
