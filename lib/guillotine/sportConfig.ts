import type { LeagueSport } from '@prisma/client'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import { GUILLOTINE_MAX_TEAMS, GUILLOTINE_MIN_TEAMS } from './teamCountLimits'

export type GuillotineSportProfile = {
  /** All guillotine leagues use weekly scoring periods */
  scoringPeriod: 'weekly'

  // ===== SCHEDULE =====
  /** Weeks in the regular season before playoffs start */
  regularSeasonWeeks: number
  /** Default team count = regularSeasonWeeks - 1 (one chop per week, last team standing at playoffs) */
  defaultTeamCount: number
  /** Min/max team limits — the same for every sport (./teamCountLimits.ts). */
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
    minTeams: GUILLOTINE_MIN_TEAMS,
    maxTeams: GUILLOTINE_MAX_TEAMS,
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
    minTeams: GUILLOTINE_MIN_TEAMS,
    maxTeams: GUILLOTINE_MAX_TEAMS,
    // NBA periods are 7 Eastern days from the Tuesday opener (lib/season-week/dailySportSeasonStarts.ts),
    // so a week runs Tuesday–Monday. The native chop (lib/guillotine/nativeGuillotineWeek.ts) fires once
    // the week is sealed (12h after the last tip) AND the 24h correction window has passed: Tuesday
    // night ET after a Monday slate. These labels said "Monday noon", a day before the week even ended.
    scoringWindowStartDay: 2, // Tuesday
    scoringWindowEndDay: 1,   // Monday
    dailyGames: true,
    primaryGameDays: [0, 1, 2, 3, 4, 5, 6],
    chopDay: 3,               // Wednesday (UTC) — the chop lands Tuesday night ET
    chopHourUtc: 11,          // by Wednesday 7am ET
    chopLabel: 'By Wednesday 7:00 AM ET',
    waiverDay: 4,             // Thursday — a full day to bid on the chopped team's players
    waiverHourUtc: 12,        // Thursday 7am ET
    waiverLabel: 'Thursday 7:00 AM ET',
    correctionWindowHours: 24,
    rosterSize: 13,
    notes: 'NBA: 3-5 games per team per week. Load management and back-to-backs are survival risks. Uneven game counts across teams each week.',
  },
  MLB: {
    scoringPeriod: 'weekly',
    regularSeasonWeeks: 26,   // ~162 games over 26 scoring weeks
    defaultTeamCount: 25,     // 26 - 1 = 25 teams
    minTeams: GUILLOTINE_MIN_TEAMS,
    maxTeams: GUILLOTINE_MAX_TEAMS,
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
    minTeams: GUILLOTINE_MIN_TEAMS,
    maxTeams: GUILLOTINE_MAX_TEAMS,
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
    minTeams: GUILLOTINE_MIN_TEAMS,
    maxTeams: GUILLOTINE_MAX_TEAMS,
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
    minTeams: GUILLOTINE_MIN_TEAMS,
    maxTeams: GUILLOTINE_MAX_TEAMS,
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
    minTeams: GUILLOTINE_MIN_TEAMS,
    maxTeams: GUILLOTINE_MAX_TEAMS,
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

/** How long before each scheduled waiver run claims are held for the blind FAAB auction. */
export const WAIVER_BLIND_WINDOW_HOURS = 36

/**
 * When `fromDate` falls inside the blind window before the next scheduled waiver run, the moment that
 * window opened; otherwise null. The window covers the chop (Tuesday night ET for NFL and NBA), so
 * every bid on a chopped team's players is settled together at the run, highest bid first. Outside
 * it, claims settle as they come, which is how managers make mid-week free-agent pickups.
 */
export function getWaiverBlindWindowStart(sport: string, fromDate?: Date): Date | null {
  if (!getGuillotineSportConfig(sport)) return null
  const now = fromDate ?? new Date()
  const next = getNextWaiverTime(sport, now)
  const opensAt = new Date(next.getTime() - WAIVER_BLIND_WINDOW_HOURS * 60 * 60 * 1000)
  return now >= opensAt ? opensAt : null
}

/** A chop this soon after a waiver run belongs to that run's week: it landed late, after its window closed. */
const LATE_CHOP_HOURS = 72
/** How long a late chop's released players are held for their own blind round. */
export const LATE_CHOP_HOLD_HOURS = 24

/**
 * The blind window is fixed to the calendar, but the chop is not: it fires when the week's stats seal,
 * so an NBA week with no Monday games chops a day early, and late stats can push a chop past the run.
 * Either way the chopped team's players would go out first-come-first-served. This anchors a hold on
 * the chop itself: an early chop holds claims from the chop until the scheduled run; a late chop (one
 * that landed within LATE_CHOP_HOURS after a run) holds them for LATE_CHOP_HOLD_HOURS. Null when the
 * latest chop is already settled.
 */
export function getChopHoldStart(sport: string, choppedAt: Date | null | undefined, fromDate?: Date): Date | null {
  if (!choppedAt || !getGuillotineSportConfig(sport)) return null
  const now = fromDate ?? new Date()
  if (choppedAt > now) return null
  const lastRun = new Date(getNextWaiverTime(sport, now).getTime() - 7 * 24 * 60 * 60 * 1000)
  if (choppedAt <= lastRun) return null
  const hoursAfterRun = (choppedAt.getTime() - lastRun.getTime()) / (60 * 60 * 1000)
  if (hoursAfterRun < LATE_CHOP_HOURS) {
    return now.getTime() < choppedAt.getTime() + LATE_CHOP_HOLD_HOURS * 60 * 60 * 1000 ? choppedAt : null
  }
  return choppedAt
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
