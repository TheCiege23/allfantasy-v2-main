import type { OptimizerPlayerInput, OptimizerSlotInput } from '@/lib/lineup-optimizer-engine/types'
import type { ExtendedLineupSport } from './lineup-sport'

export type LineupDecisionMode =
  | 'Best Lineup'
  | 'Safe Lineup'
  | 'Upside Lineup'
  | 'Must-Win Lineup'
  | 'Underdog Lineup'
  | 'Playoff-Protect Lineup'
  | 'Dynasty Development Lineup'
  | 'Injury Contingency Lineup'

type TeamDirection = 'favorite' | 'underdog' | 'neutral' | 'contender' | 'bubble' | 'rebuild'

type LeagueFormatHint =
  | 'redraft'
  | 'dynasty'
  | 'keeper'
  | 'best_ball'
  | 'guillotine'
  | 'survivor'
  | 'zombie'
  | 'tournament'
  | 'big_brother'
  | 'salary_cap'
  | 'devy'
  | 'c2c'
  | 'idp'
  | 'custom'
  | string

export interface TeamContextInput {
  record?: string
  rank?: number
  pointsFor?: number
  pointsAgainst?: number
  projectedWinProbability?: number
  isPlayoffWeek?: boolean
  weeksUntilPlayoffs?: number
  teamDirection?: TeamDirection
  opponentStrength?: number
}

export interface LeagueContextInput {
  format?: LeagueFormatHint
  scoringFormat?: string
  rosterSize?: number
  starterCount?: number
  superflex?: boolean
  tePremium?: boolean
  ppc?: boolean
  idp?: boolean
  salaryCap?: boolean
  /** True when league uses college + pro pools and rules must separate eligibility */
  c2cOrDevy?: boolean
  /** Best ball with no manual lineup — optimizer should not push sit/start swaps */
  bestBallNoManualLineup?: boolean
  lineupLockType?: 'weekly' | 'daily' | 'game_time' | string
  isMultiSport?: boolean
}

export interface UserLineupPreferenceProfileInput {
  prefersStableVeterans?: number
  prefersHighCeiling?: number
  prefersRookies?: number
  prefersStarsOverMatchups?: number
  prefersTeamLoyalty?: number
  prefersConsistency?: number
  prefersAggressiveUnderdogLineups?: number
  prefersSafeFavoriteLineups?: number
  /** Chasing matchups / streamers vs stars (learned tie-breaker) */
  prefersMatchupChasing?: number
  /** Prefer same-position bench fills on emergency swaps */
  prefersSamePositionEmergency?: number
  /** Learned trust in allowing automatic inactive substitutions */
  allowsAutoSub?: number
  /** How often user respects injury-contingency suggestions vs overrides */
  injuryContingencyTrust?: number
  /** Optional per-position trust 0–1 from promotions / history */
  positionTrust?: Record<string, number>
  /** 0–1 global weight cap for how much preferences may move close calls */
  preferenceWeight?: number
}

export interface PremiumPlayerSignals {
  /** Platform or feed injury / roster status (e.g. Out, Questionable) */
  injuryStatus?: string
  projectionScore?: number
  matchupScore?: number
  usageOpportunityScore?: number
  roleSecurityScore?: number
  recentFormScore?: number
  healthAvailabilityScore?: number
  ceilingScore?: number
  floorScore?: number
  scheduleEnvironmentScore?: number
  floorProjection?: number
  ceilingProjection?: number
  isVeteran?: boolean
  isRookie?: boolean
  byeWeek?: boolean
  /** Feed/platform confirms player will not play (enables strict auto-sub for edge cases like Doubtful→Out) */
  willNotPlayConfirmed?: boolean
}

export type PremiumPlayerInput = OptimizerPlayerInput & PremiumPlayerSignals

export interface PremiumLineupDecisionInput {
  sport?: string
  lineupMode?: LineupDecisionMode
  players: PremiumPlayerInput[]
  slots?: OptimizerSlotInput[]
  teamContext?: TeamContextInput
  leagueContext?: LeagueContextInput
  preferenceProfile?: UserLineupPreferenceProfileInput
  /** Current starters for start/sit diff (optional) */
  currentStarters?: Array<{ slotCode: string; playerId?: string; playerName?: string }>
  autoSubEnabled?: boolean
}

interface WeeklyStartScoreBreakdown {
  projectionScore: number
  matchupScore: number
  usageOpportunityScore: number
  roleSecurityScore: number
  recentFormScore: number
  healthAvailabilityScore: number
  ceilingScore: number
  floorScore: number
  scheduleEnvironmentScore: number
  weeklyStartScoreRaw: number
  weeklyStartScore: number
  volatilityScore: number
  startConfidence: number
  benchCost: number
  swapPriority: number
  effectiveObjectiveScore: number
}

export interface EnrichedPlayer {
  id: string
  name: string
  team?: string
  positions: string[]
  projectedPoints: number
  signals: PremiumPlayerSignals
  breakdown: WeeklyStartScoreBreakdown
}
