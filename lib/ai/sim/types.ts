/**
 * Shared inputs/outputs for the AllFantasy AI simulation engine (Monte Carlo + deterministic blends).
 */

export type SimLeagueSettings = Record<string, unknown>

export type SimScoringSettings = {
  /** e.g. ppr, half, std */
  format?: string
  /** Superflex etc. */
  rosterSlots?: Record<string, number>
}

export type SimPlayerInput = {
  id: string
  name?: string
  position: string
  /** Expected weekly fantasy points (this week or ROS average). */
  projection: number
  /** Standard deviation of weekly points (uncertainty). */
  variance: number
  /** 0–1, higher = less game-to-game noise (scales variance down). */
  consistency?: number
  /** 0–1, inflates variance when high. */
  injuryRisk?: number
  /** -1..1 shift on projection (usage up/down). */
  usageTrend?: number
}

export type SimRosterInput = {
  teamId: string
  players: SimPlayerInput[]
}

export type SimTeamInput = {
  id: string
  name?: string
  roster: SimPlayerInput[]
}

export type SimScheduleInput = {
  /** Week index → [homeTeamId, awayTeamId][] */
  weeks: Array<Array<{ home: string; away: string }>>
}

export type SimContext = {
  leagueSettings?: SimLeagueSettings
  scoringSettings?: SimScoringSettings
  teams: SimTeamInput[]
  rosters?: SimRosterInput[]
  schedule?: SimScheduleInput | null
  /** If schedule omitted, round-robin / random valid pairings are synthesized. */
  playerProjections?: Record<string, number>
  playerVariance?: Record<string, number>
  injuries?: Record<string, number>
  userActions?: Record<string, unknown>
}

export type MonteCarloOptions = {
  iterations: number
  /** Seed for reproducible runs (optional). */
  seed?: number
  weeksRemaining?: number
  playoffTeams?: number
  /** Weeks in regular season for synthesized schedule */
  regularSeasonWeeks?: number
}

export type SeasonSimResult = {
  championshipOdds: Record<string, number>
  playoffOdds: Record<string, number>
  avgWins: Record<string, number>
  bestCaseWins: Record<string, number>
  worstCaseWins: Record<string, number>
  iterations: number
  weeksSimulated: number
}

export type MatchupSimResult = {
  teamAId: string
  teamBId: string
  scoreA: number
  scoreB: number
  winnerId: string
  winProbA: number
  iterations: number
}

export type TradeSimResult = {
  winDelta: Record<string, number>
  playoffDelta: Record<string, number>
  championshipDelta: Record<string, number>
  riskChange: Record<string, number>
  before: SeasonSimResult
  after: SeasonSimResult
  iterations: number
  /**
   * P4-8: attached by the API route when the caller supplied league grounding —
   * real remaining-schedule win odds from the Gaussian engine, or a labeled
   * refusal. Absent entirely for ungrounded (synthetic-only) runs.
   */
  leagueGrounded?: GroundedTradeDelta
}

/** One priced week of the real remaining schedule. */
export type GroundedWeekDelta = {
  week: number
  opponentRosterId: number
  pWinBefore: number
  pWinAfter: number
}

/**
 * P4-8 — real-schedule trade delta from the Gaussian win-probability engine
 * (lib/projections/winProbability), computed ONLY when league rosters, schedule,
 * and league-scored projections all resolve. Every other case is a labeled
 * refusal; no number is invented.
 */
export type GroundedTradeDelta =
  | {
      available: true
      engine: 'gaussian-winprob-v1'
      weeks: GroundedWeekDelta[]
      weeksSkipped: Array<{ week: number; reason: string }>
      expectedWinsBefore: number
      expectedWinsAfter: number
      expectedWinsDelta: number
      /** What this is and is not — shown to the user verbatim. */
      scopeNote: string
      limitation: string
    }
  | { available: false; reason: string }

export type DraftSimResult = {
  baselineStrength: number
  withPickStrength: number
  strengthDelta: number
  /** Heuristic win prob for user team vs league avg. */
  winOddsImpact: number
  positionalBalance: number
  positionalBalanceWithPick: number
  iterations: number
}

export type WaiverSimResult = {
  rosterStrengthDelta: number
  playoffOddsDelta: number
  championshipOddsDelta?: number
  iterations: number
}

export type FranchiseSimResult = {
  years: Array<{
    year: number
    projectedStrength: number
    playoffOdds: number
    championshipOdds: number
  }>
  iterations: number
}
