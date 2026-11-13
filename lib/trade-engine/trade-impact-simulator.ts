/**
 * Trade Impact Monte Carlo Simulator
 *
 * Runs 1,000–10,000 simulations per trade to compute championship %
 * before/after and classify the trade impact.
 *
 * Includes: weekly projections, injury randomness, matchup strength,
 * schedule difficulty, precomputed distributions, and player variance caching.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlayerProjection {
  playerId: string
  name: string
  position: string
  /** Expected weekly fantasy points */
  weeklyMean: number
  /** Weekly standard deviation */
  weeklyStdDev: number
  /** Probability of missing any given week (0-1) */
  injuryRate: number
  /** Age — affects injury rate scaling */
  age: number | null
}

export interface TeamSimProfile {
  teamId: string
  name: string
  /** All rostered players with projections */
  players: PlayerProjection[]
  /** Current record */
  wins: number
  losses: number
  pointsFor: number
  /** Precomputed team-level projection (sum of starters) */
  weeklyMean: number
  weeklyStdDev: number
}

export interface ScheduleMatchup {
  opponentId: string
  week: number
  /** Matchup strength modifier (-0.15 to +0.15) — positive = harder */
  strengthModifier: number
}

export interface TradeImpactSimInput {
  /** All teams in the league with projections */
  teams: TeamSimProfile[]
  /** Index of the team being evaluated */
  targetTeamIndex: number
  /** Remaining schedule for each team (teamId → matchups) */
  schedules: Map<string, ScheduleMatchup[]>
  /** Number of playoff spots */
  playoffSpots: number
  /** Number of bye spots */
  byeSpots: number
  /** Mean PPG delta from the trade (positive = team improves) */
  tradeMeanDelta: number
  /** StdDev change from the trade */
  tradeStdDevDelta: number
  /** Player-level changes for injury simulation */
  playersGained: PlayerProjection[]
  playersLost: PlayerProjection[]
  /** Number of simulations (1000-10000, auto-capped) */
  iterations?: number
}

export type TradeImpactClassification =
  | 'major_win'      // +5%
  | 'strong_win'     // +2% to +5%
  | 'minor_edge'     // 0% to +2%
  | 'neutral'        // ~0%
  | 'negative_trade'  // <0%

export interface TradeImpactResult {
  /** Championship % before trade (0-100) */
  championshipBefore: number
  /** Championship % after trade (0-100) */
  championshipAfter: number
  /** Delta in percentage points */
  delta: number
  /** Classification of the trade impact */
  classification: TradeImpactClassification
  /** Human-readable label */
  classificationLabel: string
  /** Playoff probability before/after */
  playoffBefore: number
  playoffAfter: number
  playoffDelta: number
  /** Expected wins before/after */
  expectedWinsBefore: number
  expectedWinsAfter: number
  /** Simulation metadata */
  meta: {
    iterations: number
    injuryEventsTotal: number
    avgInjuriesPerSim: number
    scheduleDifficultyRating: number
    confidenceScore: number
    computeTimeMs: number
  }
  /** Weekly projection samples (percentiles) */
  weeklyProjection: WeeklyProjectionSample[]
}

export interface WeeklyProjectionSample {
  week: number
  /** Projected score percentiles after trade */
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Age-based injury rate multiplier */
const AGE_INJURY_MULTIPLIER: [number, number][] = [
  [23, 0.8],
  [25, 0.9],
  [27, 1.0],
  [29, 1.2],
  [31, 1.4],
  [33, 1.7],
  [35, 2.0],
]

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

function getAgeInjuryMultiplier(age: number | null): number {
  if (age == null) return 1.0
  for (const [threshold, mult] of AGE_INJURY_MULTIPLIER) {
    if (age <= threshold) return mult
  }
  return 2.0
}

// ---------------------------------------------------------------------------
// Weekly Projection Sampling
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

