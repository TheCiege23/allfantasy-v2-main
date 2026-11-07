/**
 * Best Ball sport-specific configuration.
 * Complements BestBallSportTemplate (Prisma seed) with runtime config.
 * Covers all 7 sports + tournament variants.
 */

export type BestBallSportConfig = {
  sport: string
  label: string
  /** Roster size for standard best ball */
  rosterSize: number
  /** Number of starters the optimizer selects */
  starterCount: number
  /** Lineup slot configuration */
  lineupSlots: Array<{ position: string; count: number; flex?: string[] }>
  /**
   * Default scoring period: weekly for every sport. Daily best ball is a commissioner choice for
   * NBA / NHL / MLB only, decided per league (lib/bestball/scoringPeriod.ts), never by this config.
   */
  scoringPeriod: 'weekly'
  /** Whether the commissioner may switch this sport to daily best ball. */
  dailyAvailable: boolean
  /** Total scoring weeks in a season */
  scoringWeeks: number
  /** Default tiebreaker */
  tiebreaker: 'points_for' | 'head_to_head' | 'max_week'
  /** Lock rule */
  lockRule: 'game_start' | 'first_game_of_period'
  /** Minimum depth requirements per position */
  depthRequirements: Record<string, number>
  /** Positions where boom/bust value is highest */
  highVariancePositions: string[]
  /** Tournament-specific roster size (may differ) */
  tournamentRosterSize: number
  /** Tournament starter count */
  tournamentStarterCount: number
  /** Whether this sport supports tournament best ball */
  tournamentSupported: boolean
  /** Notes for best ball in this sport */
  notes: string[]
}

export const BESTBALL_SPORT_CONFIGS: Record<string, BestBallSportConfig> = {
  nfl: {
    sport: 'nfl',
    label: 'NFL',
    rosterSize: 18,
    starterCount: 9,
    lineupSlots: [
      { position: 'QB', count: 1 },
      { position: 'RB', count: 2 },
      { position: 'WR', count: 3 },
      { position: 'TE', count: 1 },
      { position: 'FLEX', count: 1, flex: ['RB', 'WR', 'TE'] },
      { position: 'K', count: 1 },
    ],
    scoringPeriod: 'weekly',
    dailyAvailable: false,
    scoringWeeks: 17,
    tiebreaker: 'max_week',
    lockRule: 'game_start',
    depthRequirements: { QB: 2, RB: 5, WR: 5, TE: 2, K: 1 },
    highVariancePositions: ['WR', 'TE'],
    tournamentRosterSize: 18,
    tournamentStarterCount: 8,
    tournamentSupported: true,
    notes: [
      'NFL best ball is the gold standard — highest tournament volume',
      'WR depth is king: spike weeks auto-captured by optimizer',
      'Bye week stacking is a critical draft strategy',
      'Late-round QB in 1QB; early QB in Superflex',
    ],
  },
  nba: {
    sport: 'nba',
    label: 'NBA',
    rosterSize: 13,
    starterCount: 8,
    lineupSlots: [
      { position: 'PG', count: 1 },
      { position: 'SG', count: 1 },
      { position: 'SF', count: 1 },
      { position: 'PF', count: 1 },
      { position: 'C', count: 1 },
      { position: 'UTIL', count: 3, flex: ['PG', 'SG', 'SF', 'PF', 'C'] },
    ],
    scoringPeriod: 'weekly',
    dailyAvailable: true,
    scoringWeeks: 21,
    tiebreaker: 'points_for',
    lockRule: 'game_start',
    depthRequirements: { PG: 2, SG: 2, SF: 2, PF: 2, C: 2 },
    highVariancePositions: ['PG', 'SG'],
    tournamentRosterSize: 13,
    tournamentStarterCount: 8,
    tournamentSupported: true,
    notes: [
      'Load management and rest days make depth critical',
      "Weekly by default; daily best ball (each day's best lineup, summed) is a commissioner option",
      'Back-to-backs create natural variance for boom weeks',
    ],
  },
  mlb: {
    sport: 'mlb',
    label: 'MLB',
    rosterSize: 25,
    starterCount: 13,
    lineupSlots: [
      { position: 'C', count: 1 },
      { position: '1B', count: 1 },
      { position: '2B', count: 1 },
      { position: '3B', count: 1 },
      { position: 'SS', count: 1 },
      { position: 'OF', count: 3 },
      { position: 'UTIL', count: 1, flex: ['C', '1B', '2B', '3B', 'SS', 'OF'] },
      { position: 'SP', count: 2 },
      { position: 'RP', count: 2 },
    ],
    scoringPeriod: 'weekly',
    dailyAvailable: true,
    scoringWeeks: 23,
    tiebreaker: 'points_for',
    lockRule: 'game_start',
    depthRequirements: { C: 2, '1B': 2, '2B': 2, '3B': 2, SS: 2, OF: 5, SP: 5, RP: 3 },
    highVariancePositions: ['SP', 'OF'],
    tournamentRosterSize: 25,
    tournamentStarterCount: 13,
    tournamentSupported: true,
    notes: [
      'Pitcher streaming value is captured automatically',
      'Doubleheader weeks create natural scoring spikes',
      'Deeper rosters reward drafting depth over stars',
    ],
  },
  nhl: {
    sport: 'nhl',
    label: 'NHL',
    rosterSize: 16,
    starterCount: 9,
    lineupSlots: [
      { position: 'C', count: 2 },
      { position: 'W', count: 3, flex: ['LW', 'RW'] },
      { position: 'D', count: 2 },
      { position: 'UTIL', count: 1, flex: ['C', 'LW', 'RW', 'D'] },
      { position: 'G', count: 1 },
    ],
    scoringPeriod: 'weekly',
    dailyAvailable: true,
    scoringWeeks: 23,
    tiebreaker: 'points_for',
    lockRule: 'game_start',
    depthRequirements: { C: 3, LW: 2, RW: 2, D: 3, G: 2 },
    highVariancePositions: ['C', 'G'],
    tournamentRosterSize: 16,
    tournamentStarterCount: 9,
    tournamentSupported: true,
    notes: [
      'Goalie starts are unpredictable — depth at G critical',
      'Condensed schedule periods spike scoring variance',
      'Multi-goal games from forwards drive best ball value',
    ],
  },
  ncaaf: {
    sport: 'ncaaf',
    label: 'College Football',
    rosterSize: 15,
    starterCount: 7,
    lineupSlots: [
      { position: 'QB', count: 1 },
      { position: 'RB', count: 2 },
      { position: 'WR', count: 3 },
      { position: 'FLEX', count: 1, flex: ['RB', 'WR', 'TE'] },
    ],
    scoringPeriod: 'weekly',
    dailyAvailable: false,
    scoringWeeks: 14,
    tiebreaker: 'max_week',
    lockRule: 'game_start',
    depthRequirements: { QB: 2, RB: 4, WR: 5, TE: 1 },
    highVariancePositions: ['QB', 'WR'],
    tournamentRosterSize: 15,
    tournamentStarterCount: 7,
    tournamentSupported: true,
    notes: [
      'Higher game-to-game variance than NFL — boom weeks more common',
      'Unpredictable depth charts make late-round picks volatile',
      'Shorter season means each week has higher stakes',
    ],
  },
  ncaab: {
    sport: 'ncaab',
    label: 'College Basketball',
    rosterSize: 10,
    starterCount: 5,
    lineupSlots: [
      { position: 'G', count: 2, flex: ['PG', 'SG'] },
      { position: 'F', count: 2, flex: ['SF', 'PF'] },
      { position: 'C', count: 1 },
    ],
    scoringPeriod: 'weekly',
    dailyAvailable: false,
    scoringWeeks: 18,
    tiebreaker: 'points_for',
    lockRule: 'game_start',
    depthRequirements: { PG: 2, SG: 2, SF: 2, PF: 2, C: 2 },
    highVariancePositions: ['PG', 'SG'],
    tournamentRosterSize: 10,
    tournamentStarterCount: 5,
    tournamentSupported: true,
    notes: [
      'March Madness creates massive scoring variance',
      'Eliminated teams stop scoring — roster fragility risk',
      'Smaller rosters make each draft pick critical',
    ],
  },
  soccer: {
    sport: 'soccer',
    label: 'Soccer',
    rosterSize: 15,
    starterCount: 11,
    lineupSlots: [
      { position: 'GK', count: 1 },
      { position: 'DEF', count: 4 },
      { position: 'MID', count: 3 },
      { position: 'FWD', count: 3 },
    ],
    scoringPeriod: 'weekly',
    dailyAvailable: false,
    scoringWeeks: 38,
    tiebreaker: 'points_for',
    lockRule: 'game_start',
    depthRequirements: { GK: 2, DEF: 5, MID: 4, FWD: 4 },
    highVariancePositions: ['FWD', 'MID'],
    tournamentRosterSize: 15,
    tournamentStarterCount: 11,
    tournamentSupported: false,
    notes: [
      'Formation optimization auto-selects best valid formation each week',
      'Clean sheet bonuses make DEF/GK spikes valuable',
      'Double/blank gameweeks create extreme scoring variance',
      'Longest season — 38 weeks of auto-optimization',
    ],
  },
}

export function getBestBallSportConfig(sport: string): BestBallSportConfig {
  const key = sport.toLowerCase().replace(/[^a-z]/g, '')
  return BESTBALL_SPORT_CONFIGS[key] ?? BESTBALL_SPORT_CONFIGS.nfl
}
