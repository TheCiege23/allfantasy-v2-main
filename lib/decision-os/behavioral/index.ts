/**
 * Decision OS — Phase 5.0 Behavioral Event Foundation.
 *
 * Canonical, provider-agnostic behavioral event substrate.
 * Phase 5.0 exports: types, taxonomy, facts interfaces, runtime helpers.
 * Phase 5.1 will add: port (DB reads), assembler (events → facts).
 *
 * Safe to import from any Decision OS consumer — no IO, no DB access, no Prisma.
 */

export type {
  // Provenance + uncertainty
  BehavioralEventProvenance,
  BehavioralEventUncertainty,

  // Per-event metadata
  LineupViewedMetadata,
  LineupSavedMetadata,
  TradeCreatedMetadata,
  TradeAcceptedMetadata,
  TradeRejectedMetadata,
  WaiverClaimCreatedMetadata,
  WaiverClaimProcessedMetadata,
  CommissionerActionMetadata,
  RulesChangedMetadata,
  LeagueOpenedMetadata,
  LiveScoringOpenedMetadata,
  RecapViewedMetadata,
  DraftStartedMetadata,
  DraftPickMadeMetadata,

  // Metadata map + discriminated union
  BehavioralEventMetadataMap,
  BehavioralEvent,
  BehavioralEventOf,
} from './events/types'

export {
  // Runtime helpers
  isBehavioralEvent,
  clampCompleteness,
  computeEventCompleteness,
  makeSystemProvenance,
  makeImportedProvenance,
  makeMaxUncertainty,
  makeMinUncertainty,
} from './events/types'

export type {
  BehavioralEventType,
  BehavioralEventSource,
  BehavioralEventCategory,
} from './events/taxonomy'

export {
  BEHAVIORAL_EVENT_TYPES,
  BEHAVIORAL_EVENT_SOURCES,
  BEHAVIORAL_EVENT_CATEGORIES,
  BEHAVIORAL_EVENT_LABELS,
  getEventCategory,
  isBehavioralEventType,
  isBehavioralEventSource,
} from './events/taxonomy'

export type {
  ManagerBehavioralFacts,
  LeagueBehavioralFacts,
  BehavioralFactsCoverage,
  ManagerBehavioralAssemblyInput,
  LeagueBehavioralAssemblyInput,
} from './facts'

// ── Phase 5.1: Port (raw row types) ──────────────────────────────────────────

export type {
  RawWaiverClaimRow,
  RawLeagueTradeRow,
  RawRosterMoveRow,
  RawDraftSessionRow,
  RawDraftPickRow,
  RawRedraftTradeRow,
  RawRedraftRosterPlayerRow,
  RawRedraftRosterMoveRow,
} from './port'

export {
  loadWaiverClaimRows,
  loadLeagueTradeRows,
  loadRosterMoveRows,
  loadDraftRows,
  loadRedraftTradeRows,
  loadRedraftRosterPlayerRows,
  loadRedraftRosterMoveRows,
} from './port'

// ── Phase 5.1: Mappers (pure row → event) ────────────────────────────────────

export {
  mapWaiverClaimToCreatedEvent,
  mapWaiverClaimToProcessedEvent,
  mapLeagueTradeToCreatedEvent,
  mapLeagueTradeToAcceptedEvent,
  mapLeagueTradeToRejectedEvent,
  mapLeagueTradeToEvents,
  mapRosterMoveToLineupSavedEvent,
  mapDraftSessionToStartedEvent,
  mapDraftPickToEvent,
  mapWaiverClaimsToEvents,
  mapLeagueTradesToEvents,
  mapRosterMovesToEvents,
  mapDraftRowsToEvents,
} from './mappers'

// ── Phase 2E: Redraft trade + roster mappers (additive; see port.ts header) ──

export {
  mapRedraftTradeToCreatedEvent,
  mapRedraftTradeToAcceptedEvent,
  mapRedraftTradeToRejectedEvent,
  mapRedraftTradeToEvents,
  mapRedraftTradesToEvents,
  mapRedraftRosterPlayerToLineupSavedEvent,
  mapRedraftRosterPlayersToEvents,
  mapRedraftRosterMoveToLineupSavedEvent,
  mapRedraftRosterMovesToEvents,
} from './mappers'

// ── Phase 5.1: Assembler (pure events → facts) ───────────────────────────────

export {
  assembleManagerBehavioralFacts,
  assembleLeagueBehavioralFacts,
  assembleBehavioralFactsCoverage,
} from './assemble'

// ── Phase 5.2: Manager Behavioral Intelligence (pure derived intelligence) ────

export type {
  ParticipationTier,
  ManagerRetentionRisk,
  EngagementLevel,
  ManagerEngagementDimension,
  NudgePriority,
  NudgeCategory,
  ManagerNudge,
  ManagerBehavioralIntelligence,
} from './manager-intelligence'

export { deriveManagerBehavioralIntelligence } from './manager-intelligence'

// ── Phase 5.3: League Behavioral Intelligence (pure derived intelligence) ─────

export type {
  LeagueEngagementTier,
  ActivityTier,
  LeagueRetentionRisk,
  CommissionerWorkloadLevel,
  RecommendationPriority,
  RecommendationCategory,
  ManagerParticipationDistribution,
  LeagueActivityDimension,
  LeagueCommissionerRecommendation,
  LeagueHealthNarrativeInputs,
  LeagueBehavioralIntelligence,
} from './league-intelligence'

export { deriveLeagueBehavioralIntelligence } from './league-intelligence'

// ── Phase 5.4: Platform Behavioral Intelligence (pure derived intelligence) ───

export type {
  PlatformEngagementTier,
  PlatformUncertaintyLevel,
  PlatformMomentumSignal,
  PlatformTrendConfidence,
  InterventionScope,
  PlatformInterventionPriority,
  LeagueHealthDistribution,
  CommissionerQualityDistribution,
  PlatformRetentionDistribution,
  PlatformEcosystemDimension,
  HeatmapCell,
  PlatformActivityHeatmap,
  PlatformEngagementTrends,
  PlatformInterventionOpportunity,
  PlatformIntelligenceProvenance,
  PlatformBehavioralIntelligence,
} from './platform-intelligence'

export { derivePlatformBehavioralIntelligence } from './platform-intelligence'

// ── Phase 5.6: Intelligence API Internal Resolvers ───────────────────────────
// NOTE: api/contracts.ts is standalone — import it directly.
// These resolver functions map internal intelligence → curated external contracts.

export {
  resolveManagerIntelligence,
  resolveLeagueIntelligence,
  resolvePlatformIntelligenceBasic,
  resolvePlatformIntelligenceFull,
} from './api/resolvers'

// ── Phase 5.7: Intelligence API Gate + Route Handler Cores ───────────────────

export type { GateEnv, GateOk, GateErr, GateResult } from './api/gate'
export { checkIntelligenceGate } from './api/gate'

export type {
  IntelligenceApiContext,
  IntelligenceHandlerResult,
  IntelligenceDataProvider,
} from './api/intelligence-handlers'
export {
  stubDataProvider,
  platformIntelligenceHandler,
  leagueIntelligenceHandler,
  managerIntelligenceHandler,
} from './api/intelligence-handlers'

// ── Phase 5.8: Intelligence API Real Data Provider ───────────────────────────

export type { RealDataProviderDeps } from './api/real-data-provider'
export { createRealDataProvider, realDataProvider } from './api/real-data-provider'

// ── Phase 5.9: Intelligence API provider selector (env-gated opt-in) ─────────
// Route files call resolveDataProvider() to get stub or real provider based on
// DECISION_OS_INTELLIGENCE_API_PROVIDER env var.

export { resolveDataProvider } from './api/provider-selector'
