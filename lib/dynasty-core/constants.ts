/**
 * [NEW] lib/dynasty-core/constants.ts
 * Dynasty roster, scoring, playoff constants. Shared base for standard Dynasty, Devy, C2C.
 */
import { DAILY_SPORT_SEASON_SHAPE, regularSeasonWeeksFor, type DailySeasonSport } from '@/lib/sportConfig/dailySportSeasonShape'

/** Supported league team sizes for dynasty. */
export const DYNASTY_SUPPORTED_TEAM_SIZES = [4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 32] as const
export type DynastyTeamSize = (typeof DYNASTY_SUPPORTED_TEAM_SIZES)[number]

/** Bench count range by team size band. [min, max] for commissioner guidance. */
export const DYNASTY_BENCH_BY_TEAM_SIZE: Record<string, [number, number]> = {
  '4': [8, 12],
  '6': [8, 12],
  '8': [8, 12],
  '10': [12, 16],
  '12': [12, 16],
  '14': [16, 22],
  '16': [16, 22],
  '18': [20, 28],
  '20': [20, 30],
  '24': [20, 30],
  '32': [20, 30],
}

/** Default bench for 12-team dynasty (recommended preset). */
export const DYNASTY_DEFAULT_12_BENCH = 14
/** Default IR slots for dynasty. */
export const DYNASTY_DEFAULT_IR = 3
/** Default taxi slots for core dynasty (no devy). */
export const DYNASTY_DEFAULT_TAXI = 4

/**
 * The roster, scoring and playoff-week presets below are football formats (QB/RB/WR/TE, PPR, pass
 * TDs, a week-15 playoff start). They must not be offered to — or saved onto — an MLB, NBA or NHL
 * league, which the settings API and panel used to do for every sport.
 */
export function isDynastyFootballSport(sport: string | null | undefined): boolean {
  const s = String(sport ?? 'NFL').trim().toUpperCase()
  return s === 'NFL' || s === 'NCAAF'
}

/** Roster template format types for dynasty (NFL). */
export const DYNASTY_ROSTER_PRESETS = [
  { id: 'dynasty_1qb', label: '1QB Dynasty', formatType: 'dynasty_1qb' },
  { id: 'dynasty_superflex', label: 'Superflex Dynasty', formatType: 'dynasty_superflex' },
  { id: 'dynasty_2qb', label: '2QB Dynasty', formatType: 'dynasty_2qb' },
  { id: 'dynasty_tep', label: 'TEP Dynasty', formatType: 'dynasty_tep' },
  { id: 'dynasty_idp', label: 'IDP Dynasty', formatType: 'IDP' },
] as const

/** Scoring preset format types for dynasty (NFL). */
export const DYNASTY_SCORING_PRESETS = [
  { id: 'dynasty_standard', label: 'Dynasty Standard', formatType: 'dynasty_standard' },
  { id: 'dynasty_half_ppr', label: 'Dynasty Half PPR', formatType: 'dynasty_half_ppr' },
  { id: 'dynasty_full_ppr', label: 'Dynasty Full PPR', formatType: 'dynasty_full_ppr' },
  { id: 'dynasty_full_ppr_tep', label: 'Dynasty Full PPR + TEP', formatType: 'dynasty_full_ppr_tep' },
  { id: 'dynasty_superflex_default', label: 'Dynasty Superflex Default', formatType: 'dynasty_superflex_default' },
  { id: 'dynasty_6pt_pass_td', label: 'Dynasty 6pt Pass TD', formatType: 'dynasty_6pt_pass_td' },
] as const

/** Playoff team count presets. */
export const DYNASTY_PLAYOFF_PRESETS = [
  { playoffTeamCount: 4, label: '4-team playoffs' },
  { playoffTeamCount: 6, label: '6-team playoffs' },
  { playoffTeamCount: 8, label: '8-team playoffs' },
  { playoffTeamCount: 10, label: '10-team playoffs' },
] as const

/** Default regular season weeks (avoid Week 18 title). */
export const DYNASTY_REGULAR_SEASON_WEEKS_OPTIONS = [13, 14] as const
export const DYNASTY_DEFAULT_REGULAR_SEASON_WEEKS = 14

/**
 * The regular-season length a dynasty league gets when nobody chose one.
 *
 * 🛑 A FLAT 14 BROKE EVERY NBA/NHL/MLB DYNASTY LEAGUE THAT REACHED IT. `resolveCreatedSeasonWeeks`
 * sizes the season from this value (14 + 3 playoff rounds = 17 weeks — mid-February for the NBA)
 * while `League.playoffStartWeek` came from the sport default (NBA 23), so the playoff start lay
 * past the season's end. The daily sports read `dailySportSeasonShape.ts`, the one table their
 * season length lives in; football and the sports that table does not list keep 14.
 */
export function dynastyDefaultRegularSeasonWeeksFor(sport: string | null | undefined): number {
  const key = String(sport ?? '').trim().toUpperCase()
  return key in DAILY_SPORT_SEASON_SHAPE
    ? regularSeasonWeeksFor(key as DailySeasonSport)
    : DYNASTY_DEFAULT_REGULAR_SEASON_WEEKS
}

/** Rookie draft order methods. */
export const ROOKIE_PICK_ORDER_METHODS = [
  { value: 'max_pf', label: 'Reverse Max PF (anti-tank)' },
  { value: 'reverse_standings', label: 'Reverse standings' },
  { value: 'commissioner', label: 'Commissioner override' },
] as const

/** Rookie draft type. */
export const ROOKIE_DRAFT_TYPES = [
  { value: 'linear', label: 'Linear' },
  { value: 'snake', label: 'Snake' },
] as const

export const DYNASTY_DEFAULT_ROOKIE_DRAFT_ROUNDS = 4
export const DYNASTY_DEFAULT_ROOKIE_DRAFT_TYPE = 'linear'

/** Veto recommendation copy (display only). */
export const VETO_RECOMMENDATION_COPY =
  'Veto only for collusion or extreme competitive imbalance. Allow fair trades.'
