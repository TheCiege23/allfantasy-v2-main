export type {
  EngineLeagueContext,
  EnginePlayerState,
  EngineAsset,
  EngineManagerProfile,
  EngineContext,
  EngineOutput,
  EngineCapabilities,
  ConfidenceState,
  TeamPhase,
  ArchetypeId,
  InjuryStatus,
  DepthRole,
} from './types'

export { ENGINE_VERSION } from './types'

export {
  normalizeLeagueContext,
} from './normalize'

export {
  resolveCapabilities,
  resolveConfidence,
  gracefulDowngrade,
} from './capabilities'

export {
  computeScoringAdjustments,
  type ScoringAdjustment,
} from './scoring'

export {
  computePositionalScarcity,
  type PositionalScarcity,
} from './scarcity'

export {
  classifyAllTeams,
  type ContenderClassification,
} from './contender'

export {
  classifyAllArchetypes,
  archetypeAcceptanceModifier,
  type ArchetypeClassification,
} from './archetypes'

export {
  computeLDIAcceptance,
  type LDIAcceptResult,
} from './ldi-accept'

export { ENGINE_FLAGS, isEnabled, getCacheTTL } from './flags'

export type {
  SportKey,
  TradeLeagueContext,
  TradeAssetUnion,
  Asset,
  TradePlayerAsset,
  TeamContext,
  TradeEngineRequest,
  TradeEngineResponse,
} from './trade-types'

export { runTradeAnalysis } from './trade'

export {
  computeDraftProjectionScore as computeEngineDevyDPS,
  enrichDevy,
  devyValueMultiplier,
} from './devy'

export { computeLiquidity, computeLiquidity as computeEngineLiquidity } from './liquidity'

export { computeAcceptanceProbability as computeEngineAcceptance } from './acceptance'

export {
  computeContextHash,
  getCachedResult,
  setCachedResult,
  type CacheType,
} from './cache'

