/**
 * Sport-specific dynasty league configuration.
 * Defines roster sizes, taxi/devy rules, rookie draft timing,
 * offseason calendar, and development curves per sport.
 */

export type DynastySportConfig = {
  sport: string
  label: string
  /** Starter positions */
  starterSlots: string[]
  /** Bench slots */
  benchSlots: number
  /** IR slots */
  irSlots: number
  /** Default taxi squad size */
  taxiSlots: number
  /** Max taxi eligibility years (e.g., 2 = rookies + 2nd year) */
  taxiEligibilityYears: number
  /** Default devy slot count (0 if devy not naturally supported) */
  devySlots: number
  /** Whether devy is a natural fit for this sport */
  devyNatural: boolean
  /** Total roster size (starters + bench + IR + taxi + devy) */
  totalRosterSize: number

  /** Initial startup draft rounds */
  startupDraftRounds: number
  /** Annual rookie draft rounds */
  rookieDraftRounds: number
  /** Devy draft rounds (if applicable) */
  devyDraftRounds: number
  /** Default rookie draft order method */
  rookieDraftOrderMethod: 'reverse_standings' | 'lottery' | 'potential_points'
  /** Default draft pick trade years into the future */
  maxFuturePickYears: number

  /** Regular season weeks */
  regularSeasonWeeks: number
  /** Default playoff start week */
  defaultPlayoffStartWeek: number
  /** Default playoff teams */
  defaultPlayoffTeams: number

  /** Player development curve: how many years until a prospect peaks */
  avgDevelopmentYears: number
  /** Age where decline typically starts */
  typicalDeclineAge: number
  /** Rookie eligibility window (years since entering pro league) */
  rookieWindowYears: number

  /** Offseason calendar */
  offseason: {
    /** Week number when season ends */
    seasonEndWeek: number
    /** Approximate month of pro draft (1-12) */
    proDraftMonth: number
    /** Approximate month of free agency open (1-12) */
    freeAgencyMonth: number
    /**
     * Month (1-12) the fantasy rookie-draft window OPENS — on its 1st. This is the one source of truth
     * for "when is a dynasty rookie draft held": pick valuation's pre-draft bump counts down to it and
     * `rookieDraftCalendar.ts` auto-opens the draft on it. It is NOT the real pro draft (`proDraftMonth`):
     * a fantasy rookie draft follows the real one, once the rookies have teams.
     */
    rookieDraftMonth: number
    /** Last month (1-12) of the default window; omitted = the same month. May wrap the year (MLB Nov–Jan). */
    rookieDraftWindowEndMonth?: number
    /**
     * Calendar year of the window relative to the season it seeds (seasons are keyed by the year they
     * BEGIN). 0 for every sport whose draft falls between its seasons in the new season's year; -1 for
     * MLB, whose first-year-player draft is held the winter BEFORE the season (Nov 2026 seeds 2027).
     */
    rookieDraftYearOffset?: 0 | -1
    /** Approximate month of training camp / preseason (1-12) */
    trainingCampMonth: number
    /** Days for roster cut deadline after rookie draft */
    rosterCutDeadlineDays: number
  }

  /** Trade rules */
  defaultTradeDeadlineWeek: number
  /** Allow draft pick trades */
  allowPickTrades: boolean
  /** Allow FAAB trades */
  allowFaabTrades: boolean

  /** Sport-specific notes */
  notes: string[]
}

export const DYNASTY_SPORT_CONFIGS: Record<string, DynastySportConfig> = {
  nfl: {
    sport: 'nfl',
    label: 'NFL',
    starterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'K', 'DEF'],
    benchSlots: 10,
    irSlots: 3,
    taxiSlots: 5,
    taxiEligibilityYears: 2,
    devySlots: 6,
    devyNatural: true,
    totalRosterSize: 35,
    startupDraftRounds: 25,
    rookieDraftRounds: 5,
    devyDraftRounds: 4,
    rookieDraftOrderMethod: 'reverse_standings',
    maxFuturePickYears: 3,
    regularSeasonWeeks: 14,
    defaultPlayoffStartWeek: 15,
    defaultPlayoffTeams: 6,
    avgDevelopmentYears: 2,
    typicalDeclineAge: 30,
    rookieWindowYears: 2,
    offseason: {
      seasonEndWeek: 17,
      proDraftMonth: 4,
      freeAgencyMonth: 3,
      rookieDraftMonth: 5,
      trainingCampMonth: 7,
      rosterCutDeadlineDays: 14,
    },
    defaultTradeDeadlineWeek: 12,
    allowPickTrades: true,
    allowFaabTrades: true,
    notes: [
      'NFL dynasty is the gold standard — deepest prospect pools',
      'Rookie RBs can have immediate impact; WRs take 1-2 years to develop',
      'QB longevity makes them dynasty cornerstones',
      'Taxi squad critical for developing WRs drafted in rounds 2-3',
    ],
  },
  nba: {
    sport: 'nba',
    label: 'NBA',
    starterSlots: ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'UTIL', 'UTIL'],
    benchSlots: 6,
    irSlots: 3,
    taxiSlots: 4,
    taxiEligibilityYears: 2,
    devySlots: 4,
    devyNatural: true,
    totalRosterSize: 27,
    startupDraftRounds: 20,
    rookieDraftRounds: 4,
    devyDraftRounds: 3,
    rookieDraftOrderMethod: 'lottery',
    maxFuturePickYears: 3,
    regularSeasonWeeks: 20,
    defaultPlayoffStartWeek: 21,
    defaultPlayoffTeams: 6,
    avgDevelopmentYears: 2,
    typicalDeclineAge: 33,
    rookieWindowYears: 2,
    offseason: {
      seasonEndWeek: 23,
      proDraftMonth: 6,
      freeAgencyMonth: 7,
      rookieDraftMonth: 7,
      trainingCampMonth: 9,
      rosterCutDeadlineDays: 14,
    },
    defaultTradeDeadlineWeek: 18,
    allowPickTrades: true,
    allowFaabTrades: true,
    notes: [
      'NBA rookies often contribute immediately — shorter development window',
      'High trade activity makes dynasty NBA very active year-round',
      'Daily lineups add management complexity but reward active owners',
      'Lottery draft order adds excitement to offseason',
    ],
  },
  mlb: {
    sport: 'mlb',
    label: 'MLB',
    starterSlots: ['C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', 'UTIL', 'UTIL', 'SP', 'SP', 'SP', 'SP', 'RP', 'RP'],
    benchSlots: 8,
    irSlots: 4,
    taxiSlots: 6,
    taxiEligibilityYears: 3,
    devySlots: 8,
    devyNatural: true,
    totalRosterSize: 42,
    startupDraftRounds: 30,
    rookieDraftRounds: 5,
    devyDraftRounds: 5,
    rookieDraftOrderMethod: 'reverse_standings',
    maxFuturePickYears: 3,
    regularSeasonWeeks: 21,
    defaultPlayoffStartWeek: 22,
    defaultPlayoffTeams: 6,
    avgDevelopmentYears: 4,
    typicalDeclineAge: 34,
    rookieWindowYears: 3,
    offseason: {
      seasonEndWeek: 24,
      // The MLB Draft is mid-July, mid-season. Dynasty first-year-player drafts are held in the
      // offseason after the World Series (was 1: January, priced a 2027 pick as drafted Jan 2027).
      proDraftMonth: 7,
      freeAgencyMonth: 11,
      rookieDraftMonth: 11,
      rookieDraftWindowEndMonth: 1,
      rookieDraftYearOffset: -1,
      trainingCampMonth: 2,
      rosterCutDeadlineDays: 21,
    },
    defaultTradeDeadlineWeek: 18,
    allowPickTrades: true,
    allowFaabTrades: true,
    notes: [
      'MLB dynasty has the deepest prospect systems — devy is critical',
      'Longest development timeline: 3-5 years from draft to majors',
      'Pitching prospects are high-value but high-risk',
      'Larger rosters reflect the depth of MLB rosters',
      'Daily lineups with pitcher streaming add significant management load',
    ],
  },
  nhl: {
    sport: 'nhl',
    label: 'NHL',
    starterSlots: ['C', 'C', 'LW', 'LW', 'RW', 'RW', 'D', 'D', 'D', 'UTIL', 'G', 'G'],
    benchSlots: 6,
    irSlots: 3,
    taxiSlots: 4,
    taxiEligibilityYears: 3,
    devySlots: 4,
    devyNatural: false,
    totalRosterSize: 29,
    startupDraftRounds: 22,
    rookieDraftRounds: 4,
    devyDraftRounds: 3,
    rookieDraftOrderMethod: 'reverse_standings',
    maxFuturePickYears: 3,
    regularSeasonWeeks: 21,
    defaultPlayoffStartWeek: 22,
    defaultPlayoffTeams: 6,
    avgDevelopmentYears: 3,
    typicalDeclineAge: 34,
    rookieWindowYears: 2,
    offseason: {
      seasonEndWeek: 24,
      // The NHL Entry Draft is held in late June (was 7); free agency opens July 1.
      proDraftMonth: 6,
      freeAgencyMonth: 7,
      // The rookie draft follows the late-June Entry Draft in July (was 8: August).
      rookieDraftMonth: 7,
      trainingCampMonth: 9,
      rosterCutDeadlineDays: 14,
    },
    defaultTradeDeadlineWeek: 18,
    allowPickTrades: true,
    allowFaabTrades: true,
    notes: [
      'NHL prospects develop in juniors/AHL for 2-3 years typically',
      'Goalie development is unpredictable — high variance dynasty asset',
      'Daily lineups with goalie decisions drive dynasty value',
    ],
  },
  ncaaf: {
    sport: 'ncaaf',
    label: 'College Football',
    starterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'K', 'DEF'],
    benchSlots: 8,
    irSlots: 2,
    taxiSlots: 4,
    taxiEligibilityYears: 1,
    devySlots: 0,
    devyNatural: false,
    totalRosterSize: 25,
    startupDraftRounds: 20,
    rookieDraftRounds: 4,
    devyDraftRounds: 0,
    rookieDraftOrderMethod: 'reverse_standings',
    maxFuturePickYears: 2,
    regularSeasonWeeks: 12,
    defaultPlayoffStartWeek: 13,
    defaultPlayoffTeams: 4,
    avgDevelopmentYears: 1,
    typicalDeclineAge: 22,
    rookieWindowYears: 1,
    offseason: {
      seasonEndWeek: 14,
      proDraftMonth: 4,
      freeAgencyMonth: 12,
      rookieDraftMonth: 1,
      trainingCampMonth: 8,
      rosterCutDeadlineDays: 7,
    },
    defaultTradeDeadlineWeek: 10,
    allowPickTrades: true,
    allowFaabTrades: false,
    notes: [
      'College football dynasty revolves around transfer portal activity',
      'Player eligibility windows are short (4-5 years max)',
      'Recruiting rankings serve as prospect valuations',
      'Annual roster turnover is higher than pro sports',
    ],
  },
  ncaab: {
    sport: 'ncaab',
    label: 'College Basketball',
    starterSlots: ['PG', 'SG', 'SF', 'PF', 'C', 'UTIL', 'UTIL', 'UTIL'],
    benchSlots: 5,
    irSlots: 1,
    taxiSlots: 3,
    taxiEligibilityYears: 1,
    devySlots: 0,
    devyNatural: false,
    totalRosterSize: 17,
    startupDraftRounds: 15,
    rookieDraftRounds: 3,
    devyDraftRounds: 0,
    rookieDraftOrderMethod: 'lottery',
    maxFuturePickYears: 2,
    regularSeasonWeeks: 16,
    defaultPlayoffStartWeek: 17,
    defaultPlayoffTeams: 4,
    avgDevelopmentYears: 1,
    typicalDeclineAge: 22,
    rookieWindowYears: 1,
    offseason: {
      seasonEndWeek: 18,
      proDraftMonth: 6,
      freeAgencyMonth: 4,
      rookieDraftMonth: 5,
      trainingCampMonth: 10,
      rosterCutDeadlineDays: 7,
    },
    defaultTradeDeadlineWeek: 13,
    allowPickTrades: true,
    allowFaabTrades: false,
    notes: [
      'One-and-done players create extreme roster turnover',
      'Transfer portal is the primary "free agency" mechanism',
      'March Madness performance can dramatically shift player values',
      'Smaller rosters make each pick more impactful',
    ],
  },
  soccer: {
    sport: 'soccer',
    label: 'Soccer',
    starterSlots: ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'FWD'],
    benchSlots: 6,
    irSlots: 2,
    taxiSlots: 4,
    taxiEligibilityYears: 2,
    devySlots: 4,
    devyNatural: true,
    totalRosterSize: 27,
    startupDraftRounds: 22,
    rookieDraftRounds: 4,
    devyDraftRounds: 3,
    rookieDraftOrderMethod: 'reverse_standings',
    maxFuturePickYears: 3,
    regularSeasonWeeks: 34,
    defaultPlayoffStartWeek: 35,
    defaultPlayoffTeams: 4,
    avgDevelopmentYears: 3,
    typicalDeclineAge: 32,
    rookieWindowYears: 2,
    offseason: {
      seasonEndWeek: 38,
      proDraftMonth: 1,
      freeAgencyMonth: 6,
      rookieDraftMonth: 7,
      trainingCampMonth: 7,
      rosterCutDeadlineDays: 14,
    },
    defaultTradeDeadlineWeek: 30,
    allowPickTrades: true,
    allowFaabTrades: true,
    notes: [
      'Youth academy products are the soccer equivalent of devy prospects',
      'Transfer windows (Jan + summer) create concentrated activity periods',
      'Loan systems add complexity to player availability',
      'International breaks disrupt scheduling but don\'t affect dynasty rosters',
      'Longest regular season means more data points for valuations',
    ],
  },
}

export function getDynastySportConfig(sport: string): DynastySportConfig {
  const key = sport.toLowerCase().replace(/[^a-z]/g, '')
  return DYNASTY_SPORT_CONFIGS[key] ?? DYNASTY_SPORT_CONFIGS.nfl
}
