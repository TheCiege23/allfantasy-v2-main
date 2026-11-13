// lib/trade-engine/index.ts
export { runTradeEngine } from "./trade-engine";
export { buildLeagueIntelligence } from "./league-intelligence";

export { detectSurplusAssets } from "./surplusDetection";
export { applyParityGuardrailsToCandidates, computeTpiByRosterId } from "./guardrails";

export type {
  GuardrailsConfig,
  GuardrailReasonCode,
  GuardrailCandidateDebug,
} from "./guardrails";

export { guardrailReasonToCopy, guardrailCodesToUiList } from "./guardrailCopy";

export { enrichTradeCandidateWithGrok } from "./grok-enrichment";
export { runGrokAssistOnTradeEngineOutput } from "./grok-ai-layer";
export {
  runNewsImpactEngine,
  scoreNewsItems,
  computePlayerAdjustments,
  formatNewsImpactForPrompt,
} from "./news-impact-engine";
export type {
  NewsCategory,
  NewsImpactSeverity,
  RawNewsItem,
  ScoredNewsItem,
  PlayerValueAdjustment,
  NewsImpactResult,
} from "./news-impact-engine";
export type { AiProviderMode, RunAssistOptions, AssistSnapshotLike } from "./ai-assist-orchestrator";

export { computeTeamManagerContext } from "./team-manager-context-engine";
export type {
  PlayStyle,
  TeamStrength,
  TeamProfile,
  ManagerProfile,
  NeedFitResult,
  ContextMultiplier,
  ContextAdjustment,
  TeamManagerContextResult,
  StyleMatchResult,
} from "./team-manager-context-engine";

export type {
  PlayerProjection,
  TeamSimProfile,
  ScheduleMatchup,
  TradeImpactSimInput,
  TradeImpactClassification,
  TradeImpactResult,
  WeeklyProjectionSample,
} from "./trade-impact-simulator";

export {
  precomputeFromContext,
} from "./trade-analyzer-performance";
export type {
  FastTradeResult,
  TimingBreakdown,
  PrecomputedValues,
  DeferredAnalysisHandle,
} from "./trade-analyzer-performance";

export {
  getSportTuning,
  getSupportedSports,
  getScarcityMultiplier,
  getAgeCurve,
  computeAgeMultiplier,
  getVolatilityProfile,
  getScoringNormalization,
} from "./sport-tuning-registry";
export type {
  SupportedSport,
  SportTuning,
  PositionScarcity,
  AgeCurve,
  VolatilityProfile,
  ScoringNormalization,
} from "./sport-tuning-registry";

export { convertSleeperToAssets } from "./convertSleeperToAssets";

export type {
  Asset,
  TradeCandidate,
  TradeEngineOutput,
  LeagueIntelligence,
} from "./types";
