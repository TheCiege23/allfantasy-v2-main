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
  getRoundPointsSummary,
  SCORING_INFO_LABEL,
} from './BracketScoringInfoResolver'

export {
  resolveBracketSportUI,
  resolveBracketChallengeLabel,
} from './BracketSportUIResolver'

export type { BracketNodeLike } from './types'
