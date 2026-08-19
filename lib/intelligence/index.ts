export type {
  IntelligenceChipState,
  IntelligencePlatformHealth,
  IntelligenceSnapshot,
  LeagueSourceKind,
  ResolvedLeagueIntelligenceContext,
} from '@/lib/intelligence/types'

export { computeIntelligencePlatformHealth } from '@/lib/intelligence/computePlatformHealth'
export { resolveLeagueIntelligenceContext } from '@/lib/intelligence/resolveLeagueIntelligenceContext'
export { buildIntelligenceSnapshot } from '@/lib/intelligence/buildIntelligenceSnapshot'
export { buildAiToolPayload } from '@/lib/intelligence/buildAiToolPayload'
export type { AiToolPayloadEnvelope } from '@/lib/intelligence/buildAiToolPayload'
export { attachIntelligenceToChimmyPayload } from '@/lib/intelligence/chimmyIntelligenceMerge'

export { buildStandardAiPayload } from '@/lib/ai-payload/buildStandardAiPayload'
export type { BuildStandardAiPayloadArgs } from '@/lib/ai-payload/buildStandardAiPayload'
export {
  AI_PAYLOAD_SYSTEM_REMINDER,
  STANDARD_AI_TOOL_RESPONSE_JSON_SCHEMA,
} from '@/lib/ai-payload/types'
export type {
  AllFantasyStandardAiPayload,
  AiTeamContextPayload,
  StandardAiToolResponse,
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
  type LeagueActivitySummary,
  type LeagueHealthSnapshot,
  type LeagueHealthStatus,
  type ManagerActivitySnapshot,
  type CommissionerActionItem,
  type ActionItemSeverity,
  type ActionItemThresholds,
  type AuditFeedItem,
  type AuditFeedPage,
} from '@/lib/intelligence/IntelligenceQueryService'
export {
  INTELLIGENCE_FEATURES,
  AllowAllFeatureGate,
  defaultFeatureGate,
  type IFeatureGate,
  type IntelligenceFeature,
  type FeatureGatePrincipal,
  type FeatureGateDecision,
} from '@/lib/intelligence/featureGate'
// G15.9 — Chimmy commissioner-intelligence grounding adapter
export {
  detectCommissionerIntelligenceIntent,
  buildCommissionerGrounding,
  formatCommissionerGroundingText,
  type CommissionerGrounding,
  type CommissionerGroundingSummary,
  type CommissionerGroundingStatus,
} from '@/lib/intelligence/chimmy/commissionerGrounding'
