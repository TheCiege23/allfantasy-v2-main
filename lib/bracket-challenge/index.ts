/**
 * Bracket Challenge UX — view service, board renderer, pick controller,
 * leaderboard resolver, scoring info, navigation.
 */

export {
  getBracketViewState,
  getBracketProgressDisplay,
  getBracketLockStateMessage,
  type BracketViewState,
  type BracketProgressDisplay,
} from './BracketChallengeViewService'

export {
  DEFAULT_REGION_ORDER,
  getRoundLabel,
  getRoundShortLabel,
  getAdaptiveRoundLabel,
  getAdaptiveRoundShortLabel,
  getBracketRoundList,
  isClassicRegionalBoard,
} from './BracketBoardRenderer'

export {
  isPickLocked,
  computeEffectiveTeams,
  cascadeClearInvalidPicks,
} from './BracketPickController'

export {
  getPoolLeaderboardUrl,
} from './BracketLeaderboardResolver'

export {
  SCORING_MODE_INFO,
  pointsForRound,
  getRoundPointsSummary,
  SCORING_INFO_LABEL,
  type ScoringMode,
} from './BracketScoringInfoResolver'

export {
  resolveBracketSportUI,
  resolveBracketChallengeLabel,
  type BracketSportUI,
} from './BracketSportUIResolver'

export type { BracketNodeLike } from './types'
