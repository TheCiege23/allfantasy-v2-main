export type {
  IntelligenceChipState,
  IntelligencePlatformHealth,
} from '@/lib/intelligence/types'

export { computeIntelligencePlatformHealth } from '@/lib/intelligence/computePlatformHealth'
export { buildAiToolPayload } from '@/lib/intelligence/buildAiToolPayload'
export type { AiToolPayloadEnvelope } from '@/lib/intelligence/buildAiToolPayload'
export { attachIntelligenceToChimmyPayload } from '@/lib/intelligence/chimmyIntelligenceMerge'

export { buildStandardAiPayload } from '@/lib/ai-payload/buildStandardAiPayload'
export type {
  AllFantasyStandardAiPayload,
  AiTeamContextPayload,
} from '@/lib/ai-payload/types'

// ── G15.4 — event-derived Commissioner Intelligence read models (backend only) ──
export {
  INTELLIGENCE_SNAPSHOT_PROJECTION,
  categorize,
  tradeProposalDelta,
  applyIntelligenceEvent,
  createIntelligenceSnapshotConsumer,
  rebuildIntelligenceSnapshots,
  type LeagueCategory,
} from '@/lib/intelligence/projections/snapshotProjection'
export {
  IntelligenceQueryService,
  IntelligenceAccessError,
  computeHealth,
  deriveActionItems,
  type CommissionerActionItem,
} from '@/lib/intelligence/IntelligenceQueryService'
export {
  INTELLIGENCE_FEATURES,
  defaultFeatureGate,
  type IFeatureGate,
  type IntelligenceFeature,
  type FeatureGatePrincipal,
} from '@/lib/intelligence/featureGate'
// G15.9 — Chimmy commissioner-intelligence grounding adapter
export {
  detectCommissionerIntelligenceIntent,
  buildCommissionerGrounding,
  formatCommissionerGroundingText,
  type CommissionerGroundingSummary,
} from '@/lib/intelligence/chimmy/commissionerGrounding'
