/**
 * Guillotine league asset paths and default config.
 * Assets are served from public when paths are relative (e.g. /guillotine/Guillotine.png).
 */

const PUBLIC_PREFIX = process.env.NEXT_PUBLIC_APP_URL ?? ''

/** League image for guillotine branding. */
export const GUILLOTINE_LEAGUE_IMAGE =
  process.env.GUILLOTINE_LEAGUE_IMAGE ?? `${PUBLIC_PREFIX}/guillotine/Guillotine.png`

/** First league-entry media splash video. */
export const GUILLOTINE_FIRST_ENTRY_VIDEO =
  process.env.GUILLOTINE_FIRST_ENTRY_VIDEO ?? `${PUBLIC_PREFIX}/guillotine/Guillotine.mp4`

/** Post-draft intro video. */
export const GUILLOTINE_INTRO_VIDEO =
  process.env.GUILLOTINE_INTRO_VIDEO ?? `${PUBLIC_PREFIX}/guillotine/Guillotine League Intro.mp4`

/** Default stat correction window (hours) when using after_stat_corrections. */
export const DEFAULT_STAT_CORRECTION_HOURS = 48

/** Default danger margin (points below lowest projected = danger tier). */
export const DEFAULT_DANGER_MARGIN_POINTS = 10

/** Tiebreaker step identifiers. */
const TIEBREAK_BENCH_POINTS = 'bench_points'
const TIEBREAK_SEASON_POINTS = 'season_points'
const TIEBREAK_PREVIOUS_PERIOD = 'previous_period'
const TIEBREAK_DRAFT_SLOT = 'draft_slot'
const TIEBREAK_COMMISSIONER = 'commissioner'
const TIEBREAK_RANDOM = 'random'

/** Default order: bench (lower loses) -> season points -> previous period -> draft slot -> commissioner -> random. */
export const DEFAULT_TIEBREAKER_ORDER = [
  TIEBREAK_BENCH_POINTS,
  TIEBREAK_SEASON_POINTS,
  TIEBREAK_PREVIOUS_PERIOD,
  TIEBREAK_DRAFT_SLOT,
  TIEBREAK_COMMISSIONER,
  TIEBREAK_RANDOM,
] as const

/** Correction window modes. */
export const CORRECTION_IMMEDIATE = 'immediate'
export const CORRECTION_AFTER_STAT = 'after_stat_corrections'

export const RELEASE_NEXT_WAIVER = 'next_waiver_run'
