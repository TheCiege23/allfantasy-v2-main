export {
  PIPELINE_ID,
  SPORTS_DATA_NORMALIZATION_SCHEMA_VERSION,
  SOURCE_PRIORITY,
} from '@/lib/sports-data-normalization/constants'
export type { UpstreamSourceTag } from '@/lib/sports-data-normalization/constants'

export type {
  NormalizedActualPerformance,
  NormalizedFantasyProjection,
  NormalizedGameRef,
  NormalizedInjuryNewsProjectionSlice,
  NormalizedInjuryStatus,
  NormalizedPlayerSportsProfile,
  NormalizedPosition,
  NormalizedSportsDataBatch,
  NormalizedTeamRef,
  NormalizedTrendUsage,
  ProjectionBasis,
  ProjectionConfidenceBand,
} from '@/lib/sports-data-normalization/types'

export {
  resolveNormalizedPlayerSportsProfiles,
  type NormalizePlayerInput,
  type SportsPlayerRowInput,
} from '@/lib/sports-data-normalization/resolveNormalizedPlayerSportsProfiles'

export { attachSportsNormalizationToChimmyPayload } from '@/lib/sports-data-normalization/chimmyAttach'
export { mergeNormalizedSportsBatches } from '@/lib/sports-data-normalization/mergeBatches'
export { enrichChimmyWithPlayerSportsNorm } from '@/lib/sports-data-normalization/enrichChimmy'
export type { AppPrismaClient } from '@/lib/sports-data-normalization/appPrismaClient'
