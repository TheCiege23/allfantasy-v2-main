export type {
  WaiverPlayerRef,
  WaiverSuggestionAI,
  WaiverSuggestion,
} from "./waiver-types";

export { enrichWaiverSuggestionWithGrok } from "./grok-waiver-enrichment";
export { runGrokAssistOnWaiverSuggestions } from "./grok-waiver-ai-layer";

export {
  enrichRawWaiverSuggestionsWithGrok,
  mapRawSuggestionToWaiverSuggestion,
} from "./waiver-grok-adapter";
export type { PlayerLookup, WaiverGrokAdapterOptions } from "./waiver-grok-adapter";

export { scoreWaiverCandidates } from "./waiver-scoring";
export type {
  WaiverCandidate,
  WaiverRosterPlayer,
  WaiverScoringContext,
  WaiverDimensions,
  WaiverDriverId,
  WaiverDriver,
  ScoredWaiverTarget,
  CrowdTrendData,
} from "./waiver-scoring";

export { computeTeamNeeds, deriveGoalFromContext } from "./team-needs";
export type {
  SlotNeed,
  ByeWeekCluster,
  PositionalDepth,
  DropRiskOfRegret,
  TeamNeedsMap,
  UserGoal,
} from "./team-needs";

// --- Deterministic Facts Layer ---
export {
  buildDeterministicFacts,
  computePerformanceFacts,
  computeLeagueFacts,
  computeWaiverPoolFacts,
  computeDecisionFacts,
} from "./waiver-deterministic-facts";
export type {
  FactualEvidence as WaiverFactualEvidence,
  TeamStructureFacts,
  PerformanceFacts,
  LeagueFacts as WaiverLeagueFacts,
  WaiverPoolFacts,
  DecisionFacts,
  DeterministicFactsResult,
} from "./waiver-deterministic-facts";

// --- Sport Adapters ---
export {
  getWaiverSportAdapter,
} from "./waiver-sport-adapters";
export type {
  WaiverSport,
  SportWaiverAdapter,
} from "./waiver-sport-adapters";

// --- Recommendation Types & Scoring ---
export {
  WaiverResponseV2Schema,
  WaiverSuggestionV2Schema,
  RecommendationTypeEnum,
} from "./waiver-recommendation-types";
export type {
  RecommendationType,
  WaiverFitScoreInput,
  Callouts,
} from "./waiver-recommendation-types";

