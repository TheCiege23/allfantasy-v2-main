/**
 * Bracket Challenge UX — view service, board renderer, pick controller,
 * leaderboard resolver, scoring info, navigation.
 */

export {
  getBracketViewState,
  getBracketProgressDisplay,
  getBracketLockStateMessage,
} from './BracketChallengeViewService'

export {
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
} from './BracketSportUIResolver'

export type { BracketNodeLike } from './types'
