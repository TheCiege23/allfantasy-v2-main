// lib/trade-engine/index.ts
export { runTradeEngine } from "./trade-engine";
export { buildLeagueIntelligence } from "./league-intelligence";

export { detectSurplusAssets } from "./surplusDetection";
export { applyParityGuardrailsToCandidates } from "./guardrails";

export type {
  GuardrailsConfig,
  GuardrailReasonCode,
  GuardrailCandidateDebug,
} from "./guardrails";

export { guardrailCodesToUiList } from "./guardrailCopy";

export { enrichTradeCandidateWithGrok } from "./grok-enrichment";
export { runGrokAssistOnTradeEngineOutput } from "./grok-ai-layer";
export {
  runNewsImpactEngine,
  scoreNewsItems,
  computePlayerAdjustments,
  formatNewsImpactForPrompt,
} from "./news-impact-engine";
export type {
  RawNewsItem,
  PlayerValueAdjustment,
  NewsImpactResult,
} from "./news-impact-engine";
export type { RunAssistOptions } from "./ai-assist-orchestrator";

export { computeTeamManagerContext } from "./team-manager-context-engine";
export type {
  TeamManagerContextResult,
} from "./team-manager-context-engine";

export type {
  TradeImpactSimInput,
  TradeImpactResult,
} from "./trade-impact-simulator";

export {
  precomputeFromContext,
} from "./trade-analyzer-performance";
export type {
  FastTradeResult,
  DeferredAnalysisHandle,
} from "./trade-analyzer-performance";

export {
  getSupportedSports,
  getScarcityMultiplier,
  getAgeCurve,
  computeAgeMultiplier,
  getVolatilityProfile,
  getScoringNormalization,
} from "./sport-tuning-registry";
export type {
  PositionScarcity,
  AgeCurve,
  VolatilityProfile,
} from "./sport-tuning-registry";

export { convertSleeperToAssets } from "./convertSleeperToAssets";

export type {
  Asset,
  TradeCandidate,
  TradeEngineOutput,
  LeagueIntelligence,
} from "./types";
