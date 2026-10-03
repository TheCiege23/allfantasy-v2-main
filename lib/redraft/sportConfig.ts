/**
 * Sport-specific configuration for redraft leagues.
 * Defines roster slots, scoring defaults, schedule parameters,
 * waiver timing, and playoff structures per sport.
 */

export type RedraftSportConfig = {
  sport: string
  label: string
  /** Roster positions for starters */
  starterSlots: string[]
  /** Number of bench slots */
  benchSlots: number
  /** IR slots */
  irSlots: number
  /** Total roster size */
  totalRosterSize: number
  /** Default lineup frequency */
  lineupFrequency: 'weekly' | 'daily'
  /** Default scoring format */
  defaultScoringFormat: string
  /** Supported scoring formats */
  supportedScoringFormats: string[]
  /** Number of regular season weeks */
  regularSeasonWeeks: number
  /** Default playoff start week */
  defaultPlayoffStartWeek: number
  /** Default playoff team count */
  defaultPlayoffTeams: number
  /** Supported playoff sizes */
  supportedPlayoffSizes: number[]
  /** Default team count */
  defaultTeamCount: number
  /** Default draft rounds */
  defaultDraftRounds: number
  /** Default draft timer (seconds) */
  defaultDraftTimerSeconds: number
  /** Default waiver type */
  defaultWaiverType: 'faab' | 'rolling' | 'reverse_standings' | 'fcfs'
  /** Default FAAB budget */
  defaultFaabBudget: number
  /** Default waiver processing days (0=Sun, 1=Mon, ...) */
  defaultWaiverProcessDays: number[]
  /** Default waiver process time (UTC) */
  defaultWaiverProcessTimeUtc: string
  /** Default trade deadline week */
  defaultTradeDeadlineWeek: number
  /** Trade review period (hours) */
  tradeReviewPeriodHours: number
  /** Default matchup format */
  defaultMatchupFormat: 'h2h_points' | 'h2h_categories' | 'total_points' | 'roto'
  /** Supported matchup formats */
  supportedMatchupFormats: string[]
  /** Schedule notes */
  scheduleNotes: string[]
  /** Position eligibility rules */
  flexPositions: Record<string, string[]>
}

export const REDRAFT_SPORT_CONFIGS: Record<string, RedraftSportConfig> = {
  nfl: {
    sport: 'nfl',
    label: 'NFL',
    starterSlots: ['QB', 'RB', 'WR', 'WR', 'TE', 'DEF'],
    benchSlots: 6,
    irSlots: 1,
    totalRosterSize: 13,
    lineupFrequency: 'weekly',
    defaultScoringFormat: 'half_ppr',
    supportedScoringFormats: ['ppr', 'half_ppr', 'standard', 'idp'],
    regularSeasonWeeks: 14,
    defaultPlayoffStartWeek: 15,
    defaultPlayoffTeams: 6,
    supportedPlayoffSizes: [4, 6, 8],
    defaultTeamCount: 12,
    defaultDraftRounds: 12,
    defaultDraftTimerSeconds: 90,
    defaultWaiverType: 'faab',
    defaultFaabBudget: 100,
    defaultWaiverProcessDays: [3], // Wednesday
    defaultWaiverProcessTimeUtc: '10:00',
    defaultTradeDeadlineWeek: 11,
    tradeReviewPeriodHours: 24,
    defaultMatchupFormat: 'h2h_points',
    supportedMatchupFormats: ['h2h_points', 'h2h_categories', 'total_points'],
    scheduleNotes: [
      'NFL season: Weeks 1-18 (17 game weeks + 1 bye per team)',
      'Fantasy regular season typically Weeks 1-14, playoffs Weeks 15-17',
      'Thursday Night Football starts each week — early locks',
      'Monday Night Football ends each week — stat corrections Tuesday',
    ],
    flexPositions: {
      FLX: ['RB', 'WR', 'TE'],
      FLEX: ['RB', 'WR', 'TE'],
      SF: ['QB', 'RB', 'WR', 'TE'],
      SUPERFLEX: ['QB', 'RB', 'WR', 'TE'],
      SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
    },
  },
  nba: {
    sport: 'nba',
    label: 'NBA',
    starterSlots: ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'UTIL'],
    benchSlots: 4,
    irSlots: 2,
    totalRosterSize: 15,
    lineupFrequency: 'daily',
    defaultScoringFormat: 'points',
    supportedScoringFormats: ['points', 'categories_9cat', 'categories_8cat'],
    regularSeasonWeeks: 20,
    defaultPlayoffStartWeek: 21,
    defaultPlayoffTeams: 6,
    supportedPlayoffSizes: [4, 6, 8],
    defaultTeamCount: 12,
    defaultDraftRounds: 13,
    defaultDraftTimerSeconds: 60,
    defaultWaiverType: 'faab',
    defaultFaabBudget: 100,
    defaultWaiverProcessDays: [1], // Monday
    defaultWaiverProcessTimeUtc: '10:00',
    defaultTradeDeadlineWeek: 16,
    tradeReviewPeriodHours: 24,
    defaultMatchupFormat: 'h2h_points',
    supportedMatchupFormats: ['h2h_points', 'h2h_categories', 'roto'],
    scheduleNotes: [
      'NBA uses daily lineups — managers set lineups each day',
      'Weekly scoring aggregates daily totals for matchup results',
      'All-Star break (mid-February) reduces slate for ~1 week',
      'Back-to-backs affect player availability — bench depth critical',
    ],
    flexPositions: {
      G: ['PG', 'SG'],
      F: ['SF', 'PF'],
      UTIL: ['PG', 'SG', 'SF', 'PF', 'C'],
    },
  },
  mlb: {
    sport: 'mlb',
    label: 'MLB',
    starterSlots: ['C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', 'UTIL', 'SP', 'SP', 'RP', 'RP'],
    benchSlots: 5,
    irSlots: 3,
    totalRosterSize: 21,
    lineupFrequency: 'daily',
    defaultScoringFormat: 'points',
    supportedScoringFormats: ['points', 'categories_5x5', 'categories_6x6'],
    regularSeasonWeeks: 21,
    defaultPlayoffStartWeek: 22,
    defaultPlayoffTeams: 6,
    supportedPlayoffSizes: [4, 6, 8],
    defaultTeamCount: 12,
    defaultDraftRounds: 20,
    defaultDraftTimerSeconds: 60,
    defaultWaiverType: 'faab',
    defaultFaabBudget: 100,
    defaultWaiverProcessDays: [1], // Monday
    defaultWaiverProcessTimeUtc: '10:00',
    defaultTradeDeadlineWeek: 17,
    tradeReviewPeriodHours: 24,
    defaultMatchupFormat: 'h2h_points',
    supportedMatchupFormats: ['h2h_points', 'h2h_categories', 'roto'],
    scheduleNotes: [
      'MLB uses daily lineups — critical for pitcher streaming',
      'Weekly scoring aggregates daily totals',
      'All-Star break (~week 11) has reduced games',
      'Doubleheaders can spike daily scoring significantly',
      'September callups expand available player pool',
    ],
    flexPositions: {
        UTIL: ['C', '1B', '2B', '3B', 'SS', 'OF', 'LF', 'CF', 'RF', 'DH', 'TWP'],
      P: ['SP', 'RP', 'P'],
      OF: ['OF', 'LF', 'CF', 'RF'],
      CI: ['1B', '3B'],
      MI: ['2B', 'SS'],
    },
  },
  nhl: {
    sport: 'nhl',
    label: 'NHL',
    starterSlots: ['C', 'C', 'LW', 'RW', 'D', 'D', 'UTIL', 'G', 'G'],
    benchSlots: 4,
    irSlots: 2,
    totalRosterSize: 15,
    lineupFrequency: 'daily',
    defaultScoringFormat: 'points',
    supportedScoringFormats: ['points', 'categories'],
    regularSeasonWeeks: 21,
    defaultPlayoffStartWeek: 22,
    defaultPlayoffTeams: 6,
    supportedPlayoffSizes: [4, 6, 8],
    defaultTeamCount: 12,
    defaultDraftRounds: 14,
    defaultDraftTimerSeconds: 60,
    defaultWaiverType: 'faab',
    defaultFaabBudget: 100,
    defaultWaiverProcessDays: [1],
    defaultWaiverProcessTimeUtc: '10:00',
    defaultTradeDeadlineWeek: 17,
    tradeReviewPeriodHours: 24,
    defaultMatchupFormat: 'h2h_points',
    supportedMatchupFormats: ['h2h_points', 'h2h_categories', 'roto'],
    scheduleNotes: [
      'NHL uses daily lineups — goalie starts are critical decisions',
      'Overtime and shootout scoring counts',
      'Trade deadline shifts roster values significantly',
    ],
    flexPositions: {
      UTIL: ['C', 'LW', 'RW', 'D'],
    },
  },
  ncaaf: {
    sport: 'ncaaf',
    label: 'College Football',
    // No DEF starter: no college team defense exists to draft (see redraftTeamDefenseEnabled).
    starterSlots: ['QB', 'RB', 'WR', 'WR', 'TE'],
    benchSlots: 8,
    irSlots: 1,
    totalRosterSize: 14,
    lineupFrequency: 'weekly',
    defaultScoringFormat: 'half_ppr',
    supportedScoringFormats: ['ppr', 'half_ppr', 'standard'],
    // A 4-team bracket plays weeks 12-13 — NCAAF brackets end on week 13 (ncaafPlayoffWindow.ts).
    regularSeasonWeeks: 11,
    defaultPlayoffStartWeek: 12,
    defaultPlayoffTeams: 4,
    supportedPlayoffSizes: [4, 6],
    defaultTeamCount: 12,
    defaultDraftRounds: 14,
    defaultDraftTimerSeconds: 90,
    defaultWaiverType: 'faab',
    defaultFaabBudget: 100,
    defaultWaiverProcessDays: [0], // Sunday
    defaultWaiverProcessTimeUtc: '10:00',
    defaultTradeDeadlineWeek: 9,
    tradeReviewPeriodHours: 24,
    defaultMatchupFormat: 'h2h_points',
    supportedMatchupFormats: ['h2h_points', 'total_points'],
    scheduleNotes: [
      'Saturday-focused schedule with occasional weeknight games',
      'Bye weeks less uniform than NFL — check schedule carefully',
      'Conference championship weeks and bowl games extend season',
      'Shorter season means faster standings changes',
    ],
    flexPositions: {
      FLX: ['RB', 'WR', 'TE'],
      FLEX: ['RB', 'WR', 'TE'],
      SF: ['QB', 'RB', 'WR', 'TE'],
      SUPERFLEX: ['QB', 'RB', 'WR', 'TE'],
      SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
    },
  },
  ncaab: {
    sport: 'ncaab',
    label: 'College Basketball',
    starterSlots: ['PG', 'SG', 'SF', 'PF', 'C', 'UTIL', 'UTIL'],
    benchSlots: 4,
    irSlots: 1,
    totalRosterSize: 12,
    lineupFrequency: 'daily',
    defaultScoringFormat: 'points',
    supportedScoringFormats: ['points', 'categories'],
    regularSeasonWeeks: 16,
    defaultPlayoffStartWeek: 17,
    defaultPlayoffTeams: 4,
    supportedPlayoffSizes: [4, 6],
    defaultTeamCount: 10,
    defaultDraftRounds: 12,
    defaultDraftTimerSeconds: 60,
    defaultWaiverType: 'faab',
    defaultFaabBudget: 100,
    defaultWaiverProcessDays: [1],
    defaultWaiverProcessTimeUtc: '10:00',
    defaultTradeDeadlineWeek: 12,
    tradeReviewPeriodHours: 24,
    defaultMatchupFormat: 'h2h_points',
    supportedMatchupFormats: ['h2h_points', 'h2h_categories'],
    scheduleNotes: [
      'College basketball has daily lineups',
      'Conference tournaments and March Madness create scheduling variance',
      'Eliminated tournament teams stop scoring — bench depth critical',
      'Smaller rosters mean each start slot is high-value',
    ],
    flexPositions: {
      UTIL: ['PG', 'SG', 'SF', 'PF', 'C'],
    },
  },
  soccer: {
    sport: 'soccer',
    label: 'Soccer',
    starterSlots: ['GK', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'FWD'],
    benchSlots: 5,
    irSlots: 1,
    totalRosterSize: 16,
    lineupFrequency: 'weekly',
    defaultScoringFormat: 'points',
    supportedScoringFormats: ['points'],
    regularSeasonWeeks: 34,
    defaultPlayoffStartWeek: 35,
    defaultPlayoffTeams: 4,
    supportedPlayoffSizes: [4, 6],
    defaultTeamCount: 10,
    defaultDraftRounds: 15,
    defaultDraftTimerSeconds: 90,
    defaultWaiverType: 'faab',
    defaultFaabBudget: 100,
    defaultWaiverProcessDays: [2], // Tuesday
    defaultWaiverProcessTimeUtc: '10:00',
    defaultTradeDeadlineWeek: 28,
    tradeReviewPeriodHours: 48,
    defaultMatchupFormat: 'h2h_points',
    supportedMatchupFormats: ['h2h_points', 'total_points'],
    scheduleNotes: [
      'Matchweek-based scoring (Sat-Mon typically)',
      'International breaks create 2-week gaps',
      'Double gameweeks: some teams play twice — huge scoring potential',
      'Blank gameweeks: some teams don\'t play — bench depth critical',
      'Transfer windows affect player availability mid-season',
    ],
    flexPositions: {},
  },
}

export function getRedraftSportConfig(sport: string): RedraftSportConfig {
  const key = sport.toLowerCase().replace(/[^a-z]/g, '')
  return REDRAFT_SPORT_CONFIGS[key] ?? REDRAFT_SPORT_CONFIGS.nfl
}

export function getAllRedraftSportKeys(): string[] {
  return Object.keys(REDRAFT_SPORT_CONFIGS)
}
