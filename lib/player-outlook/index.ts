// lib/player-outlook/index.ts — Public exports

export {
  getPlayerOutlook,
  getPlayerOutlookBatch,
} from './player-outlook-service'
export type { GetPlayerOutlookParams } from './player-outlook-service'

export { computePlayerOutlookScores } from './player-outlook-engine'

export {
  PLAYER_OUTLOOK_SYSTEM_PROMPT,
  buildOutlookUserPrompt,
} from './player-outlook-prompt'

export {
  PlayerOutlookSchema,
  PlayerOutlookRequestSchema,
  PlayerOutlookBatchRequestSchema,
  TrendDirectionEnum,
  RiskLevelEnum,
  TimeHorizonEnum,
  FormatFitEnum,
  TIER_LABELS,
} from './player-outlook-types'

export type {
  PlayerOutlook,
  OutlookDataBundle,
  OutlookScoringResult,
  TrendDirection,
  RiskLevel,
  TimeHorizon,
  FormatFit,
} from './player-outlook-types'
