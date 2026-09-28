import type { LeagueSport } from '@prisma/client'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'

export type GuillotineSportProfile = {
  /** All guillotine leagues use weekly scoring periods */
  scoringPeriod: 'weekly'

  // ===== SCHEDULE =====
  /** Weeks in the regular season before playoffs start */
  regularSeasonWeeks: number
  /** Default team count = regularSeasonWeeks - 1 (one chop per week, last team standing at playoffs) */
  defaultTeamCount: number
  /** Min/max team limits */
  minTeams: number
  maxTeams: number

  // ===== SCORING WINDOW =====
  /** Day of week the scoring window opens (0=Sun, 1=Mon, ..., 6=Sat) */
  scoringWindowStartDay: number
  /** Day of week the scoring window closes (last games of the period) */
  scoringWindowEndDay: number
  /** Does this sport have games every day of the scoring window? */
  dailyGames: boolean
  /** Primary game days for non-daily sports */
  primaryGameDays: number[]

  // ===== CHOP DAY (same day every week) =====
  /** Day of week the chop happens (0=Sun..6=Sat). MUST be after scoring window closes. */
  chopDay: number
  /** Hour (UTC) the chop runs. Lowest scorer is eliminated at this time. */
  chopHourUtc: number
  /** Human-readable chop timing */
  chopLabel: string

  // ===== WAIVER DAY (day after chop) =====
  /** Day of week waivers process. Always the day AFTER chop day. */
  waiverDay: number
  /** Hour (UTC) waivers process. Eliminated roster enters pool, bids resolve. */
  waiverHourUtc: number
  /** Human-readable waiver timing */
  waiverLabel: string

  // ===== CORRECTIONS =====
  /** Hours after chop to allow stat corrections before elimination is final */
  correctionWindowHours: number

  // ===== ROSTER =====
  rosterSize: number

  // ===== RISK NOTES =====
  notes: string
}

/**
 * Sport-specific guillotine schedules.
 *
 * KEY RULE: defaultTeamCount = regularSeasonWeeks - 1
 * This ensures exactly 1 chop per week with the last team standing
 * at the start of playoffs.
 *
 * CHOP DAY is the same day every week for consistency.
 * WAIVER DAY is always the day after chop day.
 * Even if some games are still being played on waiver day (daily sports),
 * waivers still run — managers must account for this in their strategy.
 */
const BASE: Record<LeagueSport, GuillotineSportProfile> = {
  NFL: {
    scoringPeriod: 'weekly',
    regularSeasonWeeks: 18,
    defaultTeamCount: 17,     // 18 weeks - 1 = 17 teams
    minTeams: 4,
    maxTeams: 17,
    scoringWindowStartDay: 4, // Thursday (TNF)
    scoringWindowEndDay: 1,   // Monday (MNF)
    dailyGames: false,
    primaryGameDays: [4, 0, 1], // Thu, Sun, Mon
    chopDay: 2,               // Tuesday
    chopHourUtc: 12,          // Tuesday noon UTC (7am ET)
    chopLabel: 'Tuesday 7:00 AM ET',
    waiverDay: 3,             // Wednesday
    waiverHourUtc: 12,        // Wednesday noon UTC (7am ET)
    waiverLabel: 'Wednesday 7:00 AM ET',
    correctionWindowHours: 48,
    rosterSize: 15,
    notes: 'NFL: 1 game per team per week. Bye weeks are a major survival risk — roster depth critical weeks 5-14.',
  },
  NBA: {
    scoringPeriod: 'weekly',
    regularSeasonWeeks: 24,   // ~82 games over 24 scoring weeks
    defaultTeamCount: 23,     // 24 - 1 = 23 teams (large league!)
    minTeams: 8,
    maxTeams: 23,
    scoringWindowStartDay: 1, // Monday
    scoringWindowEndDay: 0,   // Sunday
    dailyGames: true,
    primaryGameDays: [0, 1, 2, 3, 4, 5, 6],
    chopDay: 1,               // Monday (start of next window = chop of last window)
    chopHourUtc: 16,          // Monday noon ET
    chopLabel: 'Monday 12:00 PM ET',
    waiverDay: 2,             // Tuesday
    waiverHourUtc: 12,        // Tuesday 7am ET
    waiverLabel: 'Tuesday 7:00 AM ET',
    correctionWindowHours: 24,
    rosterSize: 13,
    notes: 'NBA: 3-5 games per team per week. Load management and back-to-backs are survival risks. Uneven game counts across teams each week.',
  },
  MLB: {
    scoringPeriod: 'weekly',
    regularSeasonWeeks: 26,   // ~162 games over 26 scoring weeks
    defaultTeamCount: 25,     // 26 - 1 = 25 teams
    minTeams: 8,
    maxTeams: 25,
    scoringWindowStartDay: 1, // Monday
    scoringWindowEndDay: 0,   // Sunday
    dailyGames: true,
    primaryGameDays: [0, 1, 2, 3, 4, 5, 6],
    chopDay: 1,               // Monday
    chopHourUtc: 15,          // Monday 11am ET
    chopLabel: 'Monday 11:00 AM ET',
    waiverDay: 2,             // Tuesday
    waiverHourUtc: 10,        // Tuesday 6am ET
    waiverLabel: 'Tuesday 6:00 AM ET',
    correctionWindowHours: 24,
    rosterSize: 23,
    notes: 'MLB: 6-7 games per team per week. Pitcher/hitter splits crucial. High game volume = depth is king. Off-days and doubleheaders add variance.',
  },
  NHL: {
    scoringPeriod: 'weekly',
    regularSeasonWeeks: 24,   // ~82 games over 24 weeks
    defaultTeamCount: 23,     // 24 - 1 = 23 teams
    minTeams: 8,
    maxTeams: 23,
    scoringWindowStartDay: 1, // Monday
    scoringWindowEndDay: 0,   // Sunday
    dailyGames: true,
    primaryGameDays: [1, 2, 3, 4, 5, 6],
    chopDay: 1,               // Monday
    chopHourUtc: 16,          // Monday noon ET
    chopLabel: 'Monday 12:00 PM ET',
    waiverDay: 2,             // Tuesday
    waiverHourUtc: 12,        // Tuesday 7am ET
    waiverLabel: 'Tuesday 7:00 AM ET',
    correctionWindowHours: 24,
    rosterSize: 16,
    notes: 'NHL: 3-4 games per team per week. Goalie starts are volatile. Back-to-backs matter for goaltender scoring.',
  },
  NCAAF: {
    scoringPeriod: 'weekly',
    regularSeasonWeeks: 14,   // 14-week regular season
    defaultTeamCount: 13,     // 14 - 1 = 13 teams
    minTeams: 8,
    maxTeams: 13,
    scoringWindowStartDay: 4, // Thursday (some games)
    scoringWindowEndDay: 6,   // Saturday (main slate)
    dailyGames: false,
    primaryGameDays: [4, 6],  // Thu, Sat
    chopDay: 0,               // Sunday (day after Saturday games)
    chopHourUtc: 18,          // Sunday 1pm ET
    chopLabel: 'Sunday 1:00 PM ET',
    waiverDay: 1,             // Monday
    waiverHourUtc: 12,        // Monday 7am ET
    waiverLabel: 'Monday 7:00 AM ET',
    correctionWindowHours: 48,
    rosterSize: 14,
    notes: 'NCAAF: 1 game per team per week (mostly Saturdays). Volatile depth charts, FCS opponents, and conference schedule strength create high variance.',
  },
  NCAAB: {
    scoringPeriod: 'weekly',
    regularSeasonWeeks: 20,   // ~20 scoring weeks through March
    defaultTeamCount: 19,     // 20 - 1 = 19 teams
    minTeams: 6,
    maxTeams: 19,
    scoringWindowStartDay: 1, // Monday
    scoringWindowEndDay: 0,   // Sunday
    dailyGames: true,
    primaryGameDays: [1, 2, 3, 4, 5, 6, 0],
    chopDay: 1,               // Monday
    chopHourUtc: 16,          // Monday noon ET
    chopLabel: 'Monday 12:00 PM ET',
    waiverDay: 2,             // Tuesday
    waiverHourUtc: 12,        // Tuesday 7am ET
    waiverLabel: 'Tuesday 7:00 AM ET',
    correctionWindowHours: 24,
    rosterSize: 10,
    notes: 'NCAAB: 2-3 games per team per week. Conference tournament weeks add chaos. Uneven scheduling across conferences.',
  },
  SOCCER: {
    scoringPeriod: 'weekly',
    regularSeasonWeeks: 38,   // Most leagues: 38 matchweeks
    defaultTeamCount: 20,     // Cap at 20 (38 would be too many)
    minTeams: 6,
    maxTeams: 20,
    scoringWindowStartDay: 5, // Friday (some matches)
    scoringWindowEndDay: 1,   // Monday (occasional)
    dailyGames: false,
    primaryGameDays: [6, 0],  // Sat, Sun
    chopDay: 2,               // Tuesday
    chopHourUtc: 14,          // Tuesday 10am ET
    chopLabel: 'Tuesday 10:00 AM ET',
    waiverDay: 3,             // Wednesday
    waiverHourUtc: 10,        // Wednesday 6am ET
    waiverLabel: 'Wednesday 6:00 AM ET',
    correctionWindowHours: 48,
    rosterSize: 15,
    notes: 'Soccer: 1 match per team per matchweek. Low scoring environment — tie-breaking by bench points is critical. Formation legality must be enforced.',
  },
}

export const GUILLOTINE_SPORT_CONFIG: Record<string, GuillotineSportProfile> = Object.fromEntries(
  SUPPORTED_SPORTS.map((s) => [s, BASE[s]]),
)

export function getGuillotineSportConfig(sport: string): GuillotineSportProfile | undefined {
  return GUILLOTINE_SPORT_CONFIG[sport.toUpperCase()]
}

/**
 * Calculate the next chop time for a sport.
 */
export function getNextChopTime(sport: string, fromDate?: Date): Date {
  const config = getGuillotineSportConfig(sport)
  if (!config) return new Date()
  const now = fromDate ?? new Date()
  const result = new Date(now)
  const currentDay = result.getUTCDay()
  let daysUntil = (config.chopDay - currentDay + 7) % 7
  if (daysUntil === 0 && result.getUTCHours() >= config.chopHourUtc) daysUntil = 7
  result.setUTCDate(result.getUTCDate() + daysUntil)
  result.setUTCHours(config.chopHourUtc, 0, 0, 0)
  return result
}

/**
 * Calculate the next waiver run time for a sport.
 */
export function getNextWaiverTime(sport: string, fromDate?: Date): Date {
  const config = getGuillotineSportConfig(sport)
  if (!config) return new Date()
  const now = fromDate ?? new Date()
  const result = new Date(now)
  const currentDay = result.getUTCDay()
  let daysUntil = (config.waiverDay - currentDay + 7) % 7
  if (daysUntil === 0 && result.getUTCHours() >= config.waiverHourUtc) daysUntil = 7
  result.setUTCDate(result.getUTCDate() + daysUntil)
  result.setUTCHours(config.waiverHourUtc, 0, 0, 0)
  return result
}

/**
 * Get recommended team count for a sport (regularSeasonWeeks - 1).
 */
export function getRecommendedTeamCount(sport: string): number {
  const config = getGuillotineSportConfig(sport)
  return config?.defaultTeamCount ?? 12
}

/**
 * Check if today is chop day for a sport.
 */
export function isChopDay(sport: string, date?: Date): boolean {
  const config = getGuillotineSportConfig(sport)
  if (!config) return false
  const d = date ?? new Date()
  return d.getUTCDay() === config.chopDay
}

/**
 * Check if today is waiver day for a sport.
 */
export function isWaiverDay(sport: string, date?: Date): boolean {
  const config = getGuillotineSportConfig(sport)
  if (!config) return false
  const d = date ?? new Date()
  return d.getUTCDay() === config.waiverDay
}
