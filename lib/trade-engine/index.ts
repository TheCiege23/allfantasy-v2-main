// lib/trade-engine/index.ts
export { runTradeEngine } from "./trade-engine";

export type {
  GuardrailsConfig,
  GuardrailReasonCode,
  GuardrailCandidateDebug,
} from "./guardrails";

export { guardrailCodesToUiList } from "./guardrailCopy";

export { enrichTradeCandidateWithGrok } from "./grok-enrichment";
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

export { computeTeamManagerContext } from "./team-manager-context-engine";
export type {
  TeamManagerContextResult,
} from "./team-manager-context-engine";

export {
  getAgeCurve,
  computeAgeMultiplier,
  getVolatilityProfile,
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
