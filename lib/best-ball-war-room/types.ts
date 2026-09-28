/**
 * BEST BALL AF WAR ROOM — shared types & data-availability contract.
 *
 * CONTRACT (best ball is its OWN format — see docs/best-ball-war-room-audit.md):
 * - `bestBallWarRoomContext.ts` is the authoritative, deterministic, serializable context.
 *   Engines are pure functions over it; the AI layer explains, never invents.
 * - Best ball is DRAFT-ONLY with an AUTOMATIC optimal lineup. There is NO manual start/sit.
 *   The War Room focuses on ROSTER CONSTRUCTION, DEPTH, UPSIDE/CEILING, DRAFT PLAN, and
 *   STACK/CORRELATION — and explains that the lineup is auto-selected each scoring period.
 * - Never invent projections, ADP, stacks, correlations, exposure, or bye weeks. Missing
 *   → flagged. Waivers/trades only when league rules enable them.
 * - NFL pools never mix with NCAAF pools (sport carried through).
 */

export type DataState = 'available' | 'stale' | 'missing'

export interface BestBallDataAvailability {
  scoringRules: DataState
  rosterRules: DataState
  rosters: DataState
  playerValues: DataState
  /** Real weekly scores → spike-week ceiling/variance. */
  weeklyScores: DataState
  projections: DataState
  injuries: DataState
  news: DataState
  /** Same-team stack/correlation data (from player team). */
  teamData: DataState
  /** Bye-week clustering data (only when roster entries carry byeWeek). */
  byeWeeks: DataState
  standings: DataState
}

export interface BestBallFreshness {
  generatedAt: string
  scoresAsOf: string | null
  injuriesAsOf: string | null
}

export interface BestBallScoringSettings {
  sport: string
  scoringPreset: string
  scoringPeriod: string
  matchupFormat: string
  cumulative: boolean
}

/** A best-ball lineup slot (the AUTO-optimal lineup definition). */
export interface BestBallLineupSlot {
  code: string
  count: number
  allowedPositions: string[]
}

export interface BestBallRosterSettings {
  lineupSlots: BestBallLineupSlot[]
  /** Total auto-started slots per scoring period. */
  startingSlots: number
  recommendedRosterSize: number
  recommendedBenchSize: number
  /** Required count per BASE position derived from dedicated (non-flex) slots. */
  requiredByPosition: Record<string, number>
  /** Flex slots and which positions can fill them. */
  flexSlots: Array<{ code: string; count: number; allowedPositions: string[] }>
}

export interface BestBallSettings {
  mode: string
  draftMode: string
  contestStructure: string
  waiversEnabled: boolean
  tradesEnabled: boolean
  substitutionsEnabled: boolean
  regularSeasonLength: number
  draftComplete: boolean
}

export interface BestBallPlayerFact {
  playerId: string
  playerName: string
  position: string
  team: string | null
  byeWeek: number | null
  injuryStatus: string | null
  adp: number | null
  adpRound: number | null
  /** Average weekly score (real, when weekly scores exist). */
  avgPoints: number | null
  /** Max single-week score (spike-week ceiling, real). */
  maxPoints: number | null
  /** Spike weeks: count of weeks this player led/started in the auto lineup. */
  startedWeeks: number | null
  weekProjection: number | null
  /** True when no value signal (ADP/projection/scores) exists. */
  hasNoValueSignal: boolean
}

export interface BestBallTeamSummary {
  rosterId: string
  ownerId: string
  ownerName: string
  teamName: string | null
  wins: number
  losses: number
  ties: number
  pointsFor: number
  playoffSeed: number | null
  isUserTeam: boolean
  players: BestBallPlayerFact[]
}

/** The one canonical, serializable best-ball War Room context object. */
export interface BestBallWarRoomContext {
  leagueId: string
  leagueType: 'best_ball'
  /** True only when the stored league has explicit waiver, trade and substitution settings. */
  ruleConfigurationVerified: boolean
  sport: string
  season: number
  teamCount: number
  /** True when the draft is finished and rosters are set. */
  draftComplete: boolean
  scoring: BestBallScoringSettings
  roster: BestBallRosterSettings
  bestBall: BestBallSettings
  userRosterId: string | null
  isCommissioner: boolean
  teams: BestBallTeamSummary[]
  availability: BestBallDataAvailability
  freshness: BestBallFreshness
  missingDataFlags: string[]
  featureAvailability: {
    rosterConstruction: boolean
    depth: boolean
    upside: boolean
    draftPlan: boolean
    stacks: boolean
    waivers: boolean
    tradeAnalyze: boolean
    tradeFind: boolean
  }
}

export type BestBallWarRoomAction =
  | 'roster-construction'
  | 'depth'
  | 'upside'
  | 'draft-plan'
  | 'stacks'
  | 'risk'
  | 'waivers'
  | 'trade-analyze'
  | 'trade-find'
  | 'ask'
