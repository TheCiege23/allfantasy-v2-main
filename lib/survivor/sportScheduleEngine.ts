/**
 * Sport-Specific Scheduling Engine for Survivor League.
 *
 * Each sport has different game schedules, which affect:
 * - When lineups lock
 * - When weekly scoring finalizes
 * - When elimination council should open/close
 * - When challenges are posted
 * - When host messages are sent
 */

export interface SportScheduleConfig {
  sport: string
  /** Primary game days (0=Sun, 1=Mon, ..., 6=Sat) */
  primaryGameDays: number[]
  /** Day of week lineups lock */
  lineupLockDay: number
  /** Hour (UTC) lineups lock */
  lineupLockHourUtc: number
  /** Day scoring finalizes for the week */
  scoringFinalizeDay: number
  /** Hour (UTC) scoring finalizes */
  scoringFinalizeHourUtc: number
  /** Recommended elimination council day */
  tribalCouncilDay: number
  /** Recommended elimination council hour (UTC) */
  tribalCouncilHourUtc: number
  /** Day challenge should be posted */
  challengePostDay: number
  /** Day vote deadline should be */
  voteDeadlineDay: number
  /** Hour (UTC) vote deadline */
  voteDeadlineHourUtc: number
  /** Whether the sport has a weekly structure (NFL) or daily (NBA/MLB) */
  weekStructure: 'weekly' | 'daily' | 'weekend_heavy'
  /** Mini-games per scoring period (NFL=1, NBA/MLB=3, etc.) */
  minigamesPerWeek: number
  /** Exile draft claim window: daily for daily sports, per-scoring-period for weekly */
  exileClaimFrequency: 'daily' | 'per_period'
  /** Weeks in a typical regular season */
  regularSeasonWeeks: number
  /** Description of the schedule pattern */
  scheduleNote: string
}

export const SPORT_SCHEDULES: Record<string, SportScheduleConfig> = {
  NFL: {
    sport: 'NFL',
    primaryGameDays: [0, 1, 4], // Sun, Mon, Thu
    lineupLockDay: 4, // Thursday (TNF)
    lineupLockHourUtc: 0, // 8pm ET = midnight UTC
    scoringFinalizeDay: 2, // Tuesday (after MNF)
    scoringFinalizeHourUtc: 12,
    tribalCouncilDay: 2, // Tuesday
    tribalCouncilHourUtc: 23, // 7pm ET
    challengePostDay: 3, // Wednesday
    voteDeadlineDay: 2, // Tuesday
    voteDeadlineHourUtc: 22, // 6pm ET
    weekStructure: 'weekly',
    regularSeasonWeeks: 18,
    minigamesPerWeek: 1,
    exileClaimFrequency: 'per_period',
    scheduleNote: 'NFL: Thu/Sun/Mon games. Scores finalize Tuesday. Tribal Tuesday night.',
  },
  NBA: {
    sport: 'NBA',
    primaryGameDays: [0, 1, 2, 3, 4, 5, 6], // Daily
    lineupLockDay: 1, // Monday (start of scoring week)
    lineupLockHourUtc: 23, // 7pm ET
    scoringFinalizeDay: 1, // Sunday (end of scoring week)
    scoringFinalizeHourUtc: 6, // After late West Coast games
    tribalCouncilDay: 1, // Monday
    tribalCouncilHourUtc: 23,
    challengePostDay: 1, // Monday
    voteDeadlineDay: 1, // Monday
    voteDeadlineHourUtc: 22,
    weekStructure: 'daily',
    regularSeasonWeeks: 25,
    minigamesPerWeek: 3,
    exileClaimFrequency: 'daily',
    scheduleNote: 'NBA: Daily games. Scoring periods follow the saved season calendar; council opens only after verified final scores.',
  },
  MLB: {
    sport: 'MLB',
    primaryGameDays: [0, 1, 2, 3, 4, 5, 6], // Daily
    lineupLockDay: 1, // Monday
    lineupLockHourUtc: 22,
    scoringFinalizeDay: 0, // Sunday
    scoringFinalizeHourUtc: 5,
    tribalCouncilDay: 1, // Monday
    tribalCouncilHourUtc: 23,
    challengePostDay: 1,
    voteDeadlineDay: 1,
    voteDeadlineHourUtc: 22,
    weekStructure: 'daily',
    regularSeasonWeeks: 26,
    minigamesPerWeek: 3,
    exileClaimFrequency: 'daily',
    scheduleNote: 'MLB: Daily games. Weekly scoring Mon-Sun. Tribal Monday.',
  },
  NHL: {
    sport: 'NHL',
    primaryGameDays: [1, 2, 3, 4, 5, 6], // Mon-Sat mainly
    lineupLockDay: 1, // Monday
    lineupLockHourUtc: 23,
    scoringFinalizeDay: 1, // Sunday
    scoringFinalizeHourUtc: 6,
    tribalCouncilDay: 1,
    tribalCouncilHourUtc: 23,
    challengePostDay: 1,
    voteDeadlineDay: 1,
    voteDeadlineHourUtc: 22,
    weekStructure: 'daily',
    regularSeasonWeeks: 28,
    minigamesPerWeek: 2,
    exileClaimFrequency: 'daily',
    scheduleNote: 'NHL: Daily games. Scoring periods follow the saved season calendar; council opens only after verified final scores.',
  },
  NCAAF: {
    sport: 'NCAAF',
    primaryGameDays: [6, 4], // Saturday primary, some Thursday
    lineupLockDay: 4, // Thursday
    lineupLockHourUtc: 23,
    scoringFinalizeDay: 0, // Sunday (after Saturday games)
    scoringFinalizeHourUtc: 6,
    tribalCouncilDay: 0, // Sunday
    tribalCouncilHourUtc: 23,
    challengePostDay: 1, // Monday
    voteDeadlineDay: 0, // Sunday
    voteDeadlineHourUtc: 22,
    weekStructure: 'weekend_heavy',
    regularSeasonWeeks: 14,
    minigamesPerWeek: 1,
    exileClaimFrequency: 'per_period',
    scheduleNote: 'NCAAF: Thu/Sat games. Scores finalize Sunday. Tribal Sunday night.',
  },
  NCAAB: {
    sport: 'NCAAB',
    primaryGameDays: [0, 1, 2, 3, 4, 5, 6], // Daily during season
    lineupLockDay: 1,
    lineupLockHourUtc: 23,
    scoringFinalizeDay: 0,
    scoringFinalizeHourUtc: 6,
    tribalCouncilDay: 1,
    tribalCouncilHourUtc: 23,
    challengePostDay: 1,
    voteDeadlineDay: 1,
    voteDeadlineHourUtc: 22,
    weekStructure: 'daily',
    regularSeasonWeeks: 20,
    minigamesPerWeek: 2,
    exileClaimFrequency: 'daily',
    scheduleNote: 'NCAAB: Daily games. Weekly scoring Mon-Sun. Tribal Monday.',
  },
  SOCCER: {
    sport: 'SOCCER',
    primaryGameDays: [6, 0], // Sat/Sun primarily
    lineupLockDay: 5, // Friday (before weekend matches)
    lineupLockHourUtc: 18,
    scoringFinalizeDay: 1, // Monday
    scoringFinalizeHourUtc: 12,
    tribalCouncilDay: 1, // Monday
    tribalCouncilHourUtc: 23,
    challengePostDay: 2, // Tuesday
    voteDeadlineDay: 1,
    voteDeadlineHourUtc: 22,
    weekStructure: 'weekend_heavy',
    regularSeasonWeeks: 38,
    minigamesPerWeek: 1,
    exileClaimFrequency: 'per_period',
    scheduleNote: 'Soccer: Weekend matches. Scores finalize Monday. Tribal Monday night.',
  },
}

/**
 * Get the schedule config for a sport.
 */
export function getSportSchedule(sport: string): SportScheduleConfig {
  return SPORT_SCHEDULES[sport.toUpperCase()] ?? SPORT_SCHEDULES.NFL!
}

/**
 * Calculate the next lineup lock time for a sport.
 */
export function getNextLineupLock(sport: string, fromDate?: Date): Date {
  const config = getSportSchedule(sport)
  const now = fromDate ?? new Date()
  const result = new Date(now)

  // Find next occurrence of lockDay
  const currentDay = result.getUTCDay()
  let daysUntil = (config.lineupLockDay - currentDay + 7) % 7
  if (daysUntil === 0 && result.getUTCHours() >= config.lineupLockHourUtc) {
    daysUntil = 7
  }
  result.setUTCDate(result.getUTCDate() + daysUntil)
  result.setUTCHours(config.lineupLockHourUtc, 0, 0, 0)

  return result
}

/**
 * Calculate the next scoring finalization time.
 */
export function getNextScoringFinalize(sport: string, fromDate?: Date): Date {
  const config = getSportSchedule(sport)
  const now = fromDate ?? new Date()
  const result = new Date(now)

  const currentDay = result.getUTCDay()
  let daysUntil = (config.scoringFinalizeDay - currentDay + 7) % 7
  if (daysUntil === 0 && result.getUTCHours() >= config.scoringFinalizeHourUtc) {
    daysUntil = 7
  }
  result.setUTCDate(result.getUTCDate() + daysUntil)
  result.setUTCHours(config.scoringFinalizeHourUtc, 0, 0, 0)

  return result
}

/**
 * Calculate recommended elimination council time for a sport/week.
 */
export function getTribalCouncilTime(sport: string, fromDate?: Date): Date {
  const config = getSportSchedule(sport)
  const now = fromDate ?? new Date()
  const result = new Date(now)

  const currentDay = result.getUTCDay()
  let daysUntil = (config.tribalCouncilDay - currentDay + 7) % 7
  if (daysUntil === 0 && result.getUTCHours() >= config.tribalCouncilHourUtc) {
    daysUntil = 7
  }
  result.setUTCDate(result.getUTCDate() + daysUntil)
  result.setUTCHours(config.tribalCouncilHourUtc, 0, 0, 0)

  return result
}

/**
 * Get the recommended survivor season length (in weeks) for a sport.
 */
export function getRecommendedSeasonLength(sport: string, playerCount: number): number {
  // Need playerCount - 3 eliminations (Final 3) + 1 finale week
  const eliminationWeeks = playerCount - 3
  const seasonWeeks = eliminationWeeks + 2 // +1 for week 1 (no elim) + 1 for finale
  return seasonWeeks
}
