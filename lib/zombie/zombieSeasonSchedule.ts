import { getZombieCreationProfile, ZOMBIE_DEFAULT_MANAGERS } from './creationPolicy'
/**
 * Sport-specific season schedule for Zombie leagues.
 * Defines exact week counts, phase boundaries, and timing per sport.
 *
 * CRITICAL: Every sport must have defined week boundaries for:
 * - Regular season (infection active)
 * - Endgame / final phase (heightened stakes)
 * - Total weeks the zombie league runs
 *
 * Default lengths follow the shared platform calendar profiles. Review the selected season/competition.
 */

export type ZombieSeasonPhase = 'setup' | 'early' | 'mid' | 'late' | 'endgame' | 'finale' | 'complete'

export type ZombieSportSchedule = {
  sport: string
  label: string
  totalWeeks: number
  /** Week infection mechanics begin (usually week 1) */
  infectionStartWeek: number
  /** Week the "endgame" phase starts (heightened infection, no new serums) */
  endgameStartWeek: number
  /** Week idols/serums expire by default (Final N phase) */
  serumExpiryWeek: number
  /** Default managers per league; independent of the scoring calendar */
  defaultTeamCount: number
  /** Resolution day of the week (0=Sun, 1=Mon, ..., 6=Sat) */
  resolutionDayOfWeek: number
  /** Ambush deadline day of week */
  ambushDeadlineDayOfWeek: number
  /** Cron hour (UTC) for automation tick */
  automationHourUtc: number
  /** Weekly update default day of week */
  weeklyUpdateDayOfWeek: number
  /** Phases with week ranges */
  phases: Array<{
    phase: ZombieSeasonPhase
    startWeek: number
    endWeek: number
    label: string
    description: string
  }>
  /** Known bye/break weeks where scoring pauses */
  breakWeeks: number[]
  /** Notes for commissioners */
  notes: string[]
}

export const ZOMBIE_SEASON_SCHEDULES: Record<string, ZombieSportSchedule> = {
  nfl: {
    sport: 'nfl',
    label: 'NFL',
    totalWeeks: getZombieCreationProfile('NFL').scoringPeriods,
    infectionStartWeek: 1,
    endgameStartWeek: 13,
    serumExpiryWeek: 14,
    defaultTeamCount: ZOMBIE_DEFAULT_MANAGERS,
    resolutionDayOfWeek: 2, // Tuesday
    ambushDeadlineDayOfWeek: 3, // Wednesday
    automationHourUtc: 14, // 10am ET
    weeklyUpdateDayOfWeek: 2, // Tuesday
    phases: [
      { phase: 'early', startWeek: 1, endWeek: 4, label: 'Outbreak', description: 'Infection begins. First Zombies emerge.' },
      { phase: 'mid', startWeek: 5, endWeek: 9, label: 'Spread', description: 'Horde grows. Weapons and serums appear.' },
      { phase: 'late', startWeek: 10, endWeek: 12, label: 'Siege', description: 'Survivors consolidate. Combat intensifies.' },
      { phase: 'endgame', startWeek: 13, endWeek: 15, label: 'Final Stand', description: 'No new serums. Heightened infection. Last chance for revivals.' },
      { phase: 'finale', startWeek: 16, endWeek: getZombieCreationProfile('NFL').scoringPeriods, label: 'Apocalypse', description: 'Championship weeks. Ultimate Survivor crowned.' },
    ],
    breakWeeks: [], // NFL has no bye weeks in zombie scoring — individual player byes handled by lineup
    notes: [
      'NFL weeks run Thursday-Monday. Resolution on Tuesday after stat corrections.',
      'Zombie leagues use all 18 regular-season scoring weeks with no fantasy playoffs.',
      'Bye weeks affect individual players but not the zombie scoring week.',
    ],
  },
  nba: {
    sport: 'nba',
    label: 'NBA',
    totalWeeks: getZombieCreationProfile('NBA').scoringPeriods,
    infectionStartWeek: 1,
    endgameStartWeek: 17,
    serumExpiryWeek: 18,
    defaultTeamCount: ZOMBIE_DEFAULT_MANAGERS,
    resolutionDayOfWeek: 1, // Monday
    ambushDeadlineDayOfWeek: 2, // Tuesday
    automationHourUtc: 14,
    weeklyUpdateDayOfWeek: 1,
    phases: [
      { phase: 'early', startWeek: 1, endWeek: 5, label: 'Outbreak', description: 'Infection begins. Daily lineups critical.' },
      { phase: 'mid', startWeek: 6, endWeek: 11, label: 'Spread', description: 'Horde grows. Back-to-backs create scoring variance.' },
      { phase: 'late', startWeek: 12, endWeek: 16, label: 'Siege', description: 'Trade deadline reshuffles values. Survivors dig in.' },
      { phase: 'endgame', startWeek: 17, endWeek: 19, label: 'Final Stand', description: 'No new serums. Last revivals possible.' },
      { phase: 'finale', startWeek: 20, endWeek: getZombieCreationProfile('NBA').scoringPeriods, label: 'Apocalypse', description: 'Championship weeks. Ultimate Survivor crowned.' },
    ],
    breakWeeks: [10], // All-Star break ~week 10
    notes: [
      'NBA uses daily lineups. Weekly aggregate determines matchup winners.',
      'All-Star break (approx week 10) has reduced slates.',
      'Trade deadline (approx week 12-13) can shift roster values significantly.',
    ],
  },
  mlb: {
    sport: 'mlb',
    label: 'MLB',
    totalWeeks: getZombieCreationProfile('MLB').scoringPeriods,
    infectionStartWeek: 1,
    endgameStartWeek: 19,
    serumExpiryWeek: 20,
    defaultTeamCount: ZOMBIE_DEFAULT_MANAGERS,
    resolutionDayOfWeek: 1, // Monday
    ambushDeadlineDayOfWeek: 2,
    automationHourUtc: 14,
    weeklyUpdateDayOfWeek: 1,
    phases: [
      { phase: 'early', startWeek: 1, endWeek: 6, label: 'Outbreak', description: 'Infection begins. Pitcher streaming matters.' },
      { phase: 'mid', startWeek: 7, endWeek: 13, label: 'Spread', description: 'Mid-season form. Doubleheaders create spikes.' },
      { phase: 'late', startWeek: 14, endWeek: 18, label: 'Siege', description: 'Trade deadline reshuffles. Pennant race intensity.' },
      { phase: 'endgame', startWeek: 19, endWeek: 21, label: 'Final Stand', description: 'September callups. No new serums.' },
      { phase: 'finale', startWeek: 22, endWeek: getZombieCreationProfile('MLB').scoringPeriods, label: 'Apocalypse', description: 'Championship weeks.' },
    ],
    breakWeeks: [11], // All-Star break
    notes: [
      'MLB uses daily lineups. Weekly aggregate determines matchup winners.',
      'All-Star break (approx week 11) has no games for ~4 days.',
      'Doubleheaders can create massive single-day scoring spikes.',
      'September callups expand rosters and available players.',
    ],
  },
  nhl: {
    sport: 'nhl',
    label: 'NHL',
    totalWeeks: getZombieCreationProfile('NHL').scoringPeriods,
    infectionStartWeek: 1,
    endgameStartWeek: 19,
    serumExpiryWeek: 20,
    defaultTeamCount: ZOMBIE_DEFAULT_MANAGERS,
    resolutionDayOfWeek: 1,
    ambushDeadlineDayOfWeek: 2,
    automationHourUtc: 14,
    weeklyUpdateDayOfWeek: 1,
    phases: [
      { phase: 'early', startWeek: 1, endWeek: 6, label: 'Outbreak', description: 'Infection begins. Goalie starts critical.' },
      { phase: 'mid', startWeek: 7, endWeek: 13, label: 'Spread', description: 'Horde expands. Condensed schedule periods.' },
      { phase: 'late', startWeek: 14, endWeek: 18, label: 'Siege', description: 'Trade deadline impact. Playoff positioning.' },
      { phase: 'endgame', startWeek: 19, endWeek: 21, label: 'Final Stand', description: 'No new serums. Last survivors fight.' },
      { phase: 'finale', startWeek: 22, endWeek: getZombieCreationProfile('NHL').scoringPeriods, label: 'Apocalypse', description: 'Championship weeks.' },
    ],
    breakWeeks: [],
    notes: [
      'NHL uses daily lineups. Goalie decisions drive scoring variance.',
      'Trade deadline (approx week 14) can shift roster values.',
      'Overtime and shootout goals count toward fantasy scoring.',
    ],
  },
  ncaaf: {
    sport: 'ncaaf',
    label: 'College Football',
    totalWeeks: getZombieCreationProfile('NCAAF').scoringPeriods,
    infectionStartWeek: 1,
    endgameStartWeek: 11,
    serumExpiryWeek: 12,
    defaultTeamCount: ZOMBIE_DEFAULT_MANAGERS,
    resolutionDayOfWeek: 0, // Sunday
    ambushDeadlineDayOfWeek: 1, // Monday
    automationHourUtc: 16,
    weeklyUpdateDayOfWeek: 0,
    phases: [
      { phase: 'early', startWeek: 1, endWeek: 3, label: 'Outbreak', description: 'Infection begins. Early-season chaos.' },
      { phase: 'mid', startWeek: 4, endWeek: 7, label: 'Spread', description: 'Conference play heats up. Horde grows.' },
      { phase: 'late', startWeek: 8, endWeek: 10, label: 'Siege', description: 'Rivalry weeks. Survivors cling on.' },
      { phase: 'endgame', startWeek: 11, endWeek: 12, label: 'Final Stand', description: 'Conference championships. No new serums.' },
      { phase: 'finale', startWeek: 13, endWeek: getZombieCreationProfile('NCAAF').scoringPeriods, label: 'Apocalypse', description: 'Bowl season. Ultimate Survivor crowned.' },
    ],
    breakWeeks: [],
    notes: [
      'College football is Saturday-focused. Resolution on Sunday.',
      'The current college football profile has 15 scoring periods; review the selected season calendar.',
      'Conference championship weeks and bowl games extend the endgame.',
      'Transfer portal activity between seasons shifts values dramatically.',
    ],
  },
  ncaab: {
    sport: 'ncaab',
    label: 'College Basketball',
    totalWeeks: getZombieCreationProfile('NCAAB').scoringPeriods,
    infectionStartWeek: 1,
    endgameStartWeek: 14,
    serumExpiryWeek: 15,
    defaultTeamCount: ZOMBIE_DEFAULT_MANAGERS,
    resolutionDayOfWeek: 1, // Monday
    ambushDeadlineDayOfWeek: 2,
    automationHourUtc: 14,
    weeklyUpdateDayOfWeek: 1,
    phases: [
      { phase: 'early', startWeek: 1, endWeek: 4, label: 'Outbreak', description: 'Infection begins. Non-conference play.' },
      { phase: 'mid', startWeek: 5, endWeek: 10, label: 'Spread', description: 'Conference play. Mid-major upsets create scoring spikes.' },
      { phase: 'late', startWeek: 11, endWeek: 13, label: 'Siege', description: 'Conference tournaments begin. Survivors fight for position.' },
      { phase: 'endgame', startWeek: 14, endWeek: 16, label: 'March Madness', description: 'Tournament begins. No new serums. Maximum drama.' },
      { phase: 'finale', startWeek: 17, endWeek: getZombieCreationProfile('NCAAB').scoringPeriods, label: 'Final Four', description: 'Championship weeks. Ultimate Survivor crowned.' },
    ],
    breakWeeks: [],
    notes: [
      'College basketball uses daily lineups.',
      'March Madness (weeks 14-18) creates extreme scheduling variance.',
      'Eliminated tournament teams stop scoring — bench depth critical.',
      'Default field: 20 managers. Review roster depth and infection pressure when changing field size.',
    ],
  },
  soccer: {
    sport: 'soccer',
    label: 'Soccer',
    totalWeeks: getZombieCreationProfile('SOCCER').scoringPeriods,
    infectionStartWeek: 1,
    endgameStartWeek: 32,
    serumExpiryWeek: 34,
    defaultTeamCount: ZOMBIE_DEFAULT_MANAGERS,
    resolutionDayOfWeek: 2, // Tuesday
    ambushDeadlineDayOfWeek: 3, // Wednesday
    automationHourUtc: 14,
    weeklyUpdateDayOfWeek: 2,
    phases: [
      { phase: 'early', startWeek: 1, endWeek: 8, label: 'Outbreak', description: 'Infection begins. Matchweek rhythm establishes.' },
      { phase: 'mid', startWeek: 9, endWeek: 19, label: 'Spread', description: 'International breaks. Double gameweeks create spikes.' },
      { phase: 'late', startWeek: 20, endWeek: 31, label: 'Siege', description: 'Transfer window reshuffles. Blank gameweeks test depth.' },
      { phase: 'endgame', startWeek: 32, endWeek: 36, label: 'Final Stand', description: 'No new serums. Relegation/title race intensity.' },
      { phase: 'finale', startWeek: 37, endWeek: getZombieCreationProfile('SOCCER').scoringPeriods, label: 'Apocalypse', description: 'Final matchweeks. Ultimate Survivor crowned.' },
    ],
    breakWeeks: [], // Matchweeks already exclude calendar gaps; do not skip four scoring rounds.
    notes: [
      'Soccer follows matchweeks (Sat-Mon). Resolution on Tuesday.',
      'Competition calendars differ. International breaks are calendar gaps, not skipped matchweek numbers.',
      'Double gameweeks: some teams play twice — massive scoring potential.',
      'Blank gameweeks: some teams don\'t play — bench depth critical.',
      'Longest zombie season (38 weeks) — slower infection spread is balanced by more total weeks.',
    ],
  },
}

export function getZombieSeasonSchedule(sport: string): ZombieSportSchedule {
  const key = sport.toLowerCase().replace(/[^a-z]/g, '')
  return ZOMBIE_SEASON_SCHEDULES[key] ?? ZOMBIE_SEASON_SCHEDULES.nfl
}

export function getCurrentPhase(sport: string, week: number): ZombieSeasonPhase {
  const schedule = getZombieSeasonSchedule(sport)
  for (const phase of schedule.phases) {
    if (week >= phase.startWeek && week <= phase.endWeek) return phase.phase
  }
  if (week > schedule.totalWeeks) return 'complete'
  return 'setup'
}

export function getPhaseLabel(sport: string, week: number): string {
  const schedule = getZombieSeasonSchedule(sport)
  for (const phase of schedule.phases) {
    if (week >= phase.startWeek && week <= phase.endWeek) return phase.label
  }
  return 'Pre-Season'
}

export function isBreakWeek(sport: string, week: number): boolean {
  return getZombieSeasonSchedule(sport).breakWeeks.includes(week)
}

export function isEndgame(sport: string, week: number): boolean {
  const schedule = getZombieSeasonSchedule(sport)
  return week >= schedule.endgameStartWeek
}

export function areSerumsExpired(sport: string, week: number): boolean {
  const schedule = getZombieSeasonSchedule(sport)
  return week >= schedule.serumExpiryWeek
}

export function getWeeksRemaining(sport: string, week: number): number {
  return Math.max(0, getZombieSeasonSchedule(sport).totalWeeks - week)
}

/** Summary for display in UI */
export function getScheduleSummary(sport: string): {
  totalWeeks: number
  phases: Array<{ label: string; weeks: string; description: string }>
  breakWeeks: number[]
  notes: string[]
} {
  const s = getZombieSeasonSchedule(sport)
  return {
    totalWeeks: s.totalWeeks,
    phases: s.phases.map((p) => ({
      label: p.label,
      weeks: `Wk ${p.startWeek}-${p.endWeek}`,
      description: p.description,
    })),
    breakWeeks: s.breakWeeks,
    notes: s.notes,
  }
}
