/**
 * AllFantasy Deterministic Insight Calculators — Public API
 *
 * All functions here are pure: no DB calls, no AI calls, no side effects.
 * Every calculator receives pre-fetched data and returns typed results
 * that flow directly into the AI grounding contract's computedInsights field.
 *
 * Import pattern:
 *   import { computeLeaderboardMovement, computeMaxPossiblePoints } from "@/lib/ai/insights"
 */

// ── Calculator functions ───────────────────────────────────────────────────────
export { computeLeaderboardMovement } from "./leaderboardMovement"
export { computeMaxPossiblePoints } from "./maxPossiblePoints"
export { computeChampionPickLeverage } from "./championPickLeverage"
export { computeMatchupSwingScores } from "./matchupSwingScore"
export { computeRootingGuide } from "./rootingGuide"
export { computeIncompletePicks } from "./incompletePicks"
export { computeCommissionerRecap } from "./commissionerRecap"
export { computePoolParity } from "./poolParity"
export { computeUpsetImpact } from "./upsetImpact"

// ── Result types ───────────────────────────────────────────────────────────────
export type { RankChange, LeaderboardScenario, LeaderboardShift } from "./leaderboardMovement"
export type { MaxPossibleResult, MaxPossibleSummary } from "./maxPossiblePoints"
export type { ChampionLeverage, ChampionPickLeverageResult } from "./championPickLeverage"
export type {
  GroupTeamStanding,
  GroupAdvancementStatus,
  GroupAdvancementResult,
} from "./groupAdvancement"
export type { MatchSwingScore, MatchupSwingSummary } from "./matchupSwingScore"
export type { RootingNeed, RootingGuideResult } from "./rootingGuide"
export type { IncompleteEntry, IncompletePicksResult } from "./incompletePicks"
export type { CommissionerRecapResult } from "./commissionerRecap"
export type { PoolParityResult } from "./poolParity"
export type { UpsetImpactResult, UpsetImpactSummary } from "./upsetImpact"
export type { BracketPathNode, BracketPathResult } from "./bracketPath"

// ── Shared input types ─────────────────────────────────────────────────────────
export type { InsightEntry, InsightPick, InsightMatch, InsightPool } from "./types"
