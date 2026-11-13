/**
 * [NEW] lib/nba-schedule/types.ts
 * NBA scheduling intelligence layer — type definitions.
 * Sits between real NBA game data (GameSchedule) and league-type-specific schedule logic.
 */

/** Day volume classification based on NBA game count. */
export type DayClassification = 'heavy' | 'moderate' | 'light' | 'off'

/** Role a fantasy day plays in a league's weekly cycle. */
type FantasyDayRole =
  | 'scoring'        // Normal scoring day (games count)
  | 'ceremony'       // Specialty league ceremony/event day (Survivor tribal, BB eviction)
  | 'admin'          // Admin processing (waiver runs, status updates)
  | 'transition'     // Between-round transition (Tournament redraft, bracket reset)
  | 'rest'           // Non-scoring rest day
  | 'elimination'    // Guillotine chop processing
  | 'status_update'  // Zombie infection/serum/weapon processing

/** Volume profile for a single day within a fantasy week. */
export interface DayVolume {
  date: string        // ISO date string (YYYY-MM-DD)
  dayOfWeek: number   // 0=Sun, 1=Mon, ..., 6=Sat
  gameCount: number
  classification: DayClassification
  teams: string[]     // Team abbreviations playing on this day
}

/** Aggregate volume profile for a full fantasy week. */
export interface WeekVolumeProfile {
  season: number
  week: number
  days: DayVolume[]
  totalGames: number
  gamesPerDay: Record<string, number>  // ISO date → count
  leastBusyDay: DayVolume | null
  secondLeastBusyDay: DayVolume | null
  mostBusyDay: DayVolume | null
  averageGamesPerDay: number
}

/** A single event in the fantasy week plan. */
export interface FantasyDayEvent {
  date: string
  role: FantasyDayRole
  label: string
  description?: string
  automationAction?: string  // Maps to automation service action names
}

/** Complete fantasy week plan for a league. */
export interface FantasyWeekPlan {
  season: number
  week: number
  scoringDays: string[]            // ISO dates where games count toward scoring
  ceremonyDay: string | null       // Specialty league ceremony/event day
  adminDay: string | null          // Admin processing day
  transitionDay: string | null     // Transition/redraft day
  eliminationDay: string | null    // Guillotine chop day
  statusUpdateDay: string | null   // Zombie processing day
  events: FantasyDayEvent[]        // All events for the week
  nonScoringDays: string[]         // Days where NBA games happen but don't count
  volumeProfile: WeekVolumeProfile // Underlying volume data
}

/** Per-league NBA schedule configuration (stored in League.settings JSON). */
export interface NbaScheduleConfig {
  /** Whether to use dynamic low-volume day detection for specialty events. */
  useDynamicLowVolumeDays: boolean
  /** Override: specific day of week for elimination (0-6). null = auto-detect from volume. */
  eliminationDayOverride: number | null
  /** Override: specific day of week for ceremony. null = auto-detect. */
  ceremonyDayOverride: number | null
  /** Override: specific day of week for admin processing. null = auto-detect. */
  adminDayOverride: number | null
  /** Game count threshold for "heavy" classification. */
  volumeThresholdHeavy: number
  /** Game count threshold for "moderate" classification. */
  volumeThresholdModerate: number
  /** Whether to prefer the second-least-busy day for admin (reserves least-busy for ceremony). */
  adminOnSecondLeastBusy: boolean
  /** Number of balanced scoring days to select (Survivor-style). 0 = all game days. */
  balancedScoringDayCount: number
  /** Whether the final NBA regular season week counts for fantasy scoring. */
  finalWeekCounts: boolean
  /** Tournament: non-scoring transition days between rounds. */
  transitionDayCount: number
  /** C2C: whether to show separate college/pro scoring subtotals. */
  separateSubtotalDisplay: boolean
}

/** Default NBA schedule config. */
export const DEFAULT_NBA_SCHEDULE_CONFIG: NbaScheduleConfig = {
  useDynamicLowVolumeDays: true,
  eliminationDayOverride: null,
  ceremonyDayOverride: null,
  adminDayOverride: null,
  volumeThresholdHeavy: 9,
  volumeThresholdModerate: 5,
  adminOnSecondLeastBusy: true,
  balancedScoringDayCount: 0,
  finalWeekCounts: true,
  transitionDayCount: 1,
  separateSubtotalDisplay: false,
}

/** Interface for league-type-specific schedule adapters. */
export interface LeagueScheduleAdapter {
  /** Resolve the fantasy week plan for this league type. */
  resolveFantasyWeek(
    volumeProfile: WeekVolumeProfile,
    config: NbaScheduleConfig,
    context?: Record<string, unknown>
  ): FantasyWeekPlan
}
