/**
 * Unified AI Interface — shared types and context contract.
 * AllFantasy AI is information-driven: deterministic-first, fact-grounded, no invented claims.
 */

import type { LeagueSport } from "@prisma/client"
import type { DeterministicContextEnvelope } from '@/lib/ai-context-envelope/schema'

/** Orchestration mode for AI execution. */
export type OrchestrationMode =
  | "single_model"   // One model only
  | "specialist"     // e.g. DeepSeek for analysis + OpenAI for explanation
  | "consensus"      // Multiple models in parallel, compare/merge
  | "unified_brain"  // Deterministic + DeepSeek + Grok + OpenAI → one response

/** Which model(s) to use. */
export type AIModelRole = "openai" | "deepseek" | "grok" | "anthropic"
/** Assistant routing target (non-core 3-model orchestration surfaces). */
export type AIAssistantRole =
  | "chimmy"
  | "openclaw_dev_assistant"
  | "openclaw_growth_marketing_assistant"

/**
 * Shared context envelope every AI-enabled feature should pass into the orchestration layer.
 * Unified AI contract (Prompt 123): deterministic-first, sport/league/format present where applicable.
 * All AI entry points should build and pass this envelope; do not invent or override deterministic results.
 */
export interface AIContextEnvelope {
  /** Feature/tool identifier (trade_analyzer, waiver_ai, chimmy_chat, graph_insight, etc.). */
  featureType: string
  /** Sport (NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER). */
  sport: string
  /** League id when in league context. */
  leagueId?: string | null
  /** Team/roster id for team-scoped AI modules. */
  teamId?: string | null
  /** User id when known. */
  userId?: string | null
  /** Legacy league format/type used by Chimmy specialty modules. */
  leagueType?: string | null
  /** Admin context for privileged league tooling. */
  isAdmin?: boolean
  /** Deterministic engine output (trade fairness, rankings, simulation, waiver scores). Must not be overridden by AI. */
  deterministicPayload?: Record<string, unknown> | null
  /** Stats/numbers passed for interpretation (not invented). */
  statisticsPayload?: Record<string, unknown> | null
  /** Behavioral/psychological/prestige context when available. */
  behaviorPayload?: Record<string, unknown> | null
  /** Simulation/projection context when available. */
  simulationPayload?: Record<string, unknown> | null
  /** Rankings/ordering context when available. */
  rankingsPayload?: Record<string, unknown> | null
  /** User intent: explain, recommend, compare, summarize, etc. */
  promptIntent?: string
  /** UI surface: drawer, modal, chat, inline, etc. */
  uiSurface?: string
  /** Confidence/uncertainty from deterministic layer. */
  confidenceMetadata?: { score?: number; label?: string; reason?: string } | null
  /** Data quality/freshness hints. */
  dataQualityMetadata?: { stale?: boolean; missing?: string[] } | null
  /** Hard constraints: e.g. "do not override fairnessScore", "use only provided roster". */
  hardConstraints?: string[]
  /** Hints for which model(s) to prefer. */
  modelRoutingHints?: AIModelRole[]
  /** Optional assistant routing hints (e.g. Chimmy/OpenClaw entry surfaces). */
  assistantRoutingHints?: AIAssistantRole[]
  /**
   * Server Time Engine snapshot (UTC + account TZ + device signals).
   * Injected by orchestration when `userId` is set — do not rely on device clock for deadlines.
   */
  afTimeContext?: Record<string, unknown> | null
  /** Raw user message or prompt suffix. */
  userMessage?: string
  /** Lightweight reaction feedback used by legacy Chimmy memory integration. */
  userFeedback?: { liked?: boolean | null } | null
  /**
   * Optional deterministic envelope used by grounded tools (trade/waiver/draft/matchup/rankings/story/content).
   * When present, providers must use this as the fact source and surface uncertainty/missing-data explicitly.
   */
  deterministicContextEnvelope?: DeterministicContextEnvelope | null
}

/** Result shape from a single model. */
export interface ModelOutput {
  model: AIModelRole
  modelName?: string
  raw: string
  structured?: Record<string, unknown> | null
  error?: string
  skipped?: boolean
  tokensPrompt?: number
  tokensCompletion?: number
}

/** Combined result after orchestration. */
export interface OrchestrationResult {
  mode: OrchestrationMode
  primaryAnswer: string
  confidencePct?: number
  confidenceLabel?: "low" | "medium" | "high"
  recommendedTool?: string
  reason?: string
  strategyNote?: string
  modelOutputs: ModelOutput[]
  usedDeterministic: boolean
  factGuardWarnings?: string[]
}

/** Tool/surface identifiers for routing and entry resolution. */
export type ToolAIEntryKey =
  | "trade_analyzer"
  | "trade_evaluator"
  | "waiver_ai"
  | "rankings"
  | "draft_helper"
  | "chimmy_chat"
  | "graph_insight"
  | "psychological"
  | "psychological_profiles"
  | "legacy_score"
  | "reputation"
  | "rivalries"
  | "awards"
  | "record_book"
  | "career_prestige"
  | "xp_explain"
  | "gm_economy_explain"
  | "bracket_intelligence"
  | "simulation"
  | "matchup"
  | "league_matchup_ai"
  | "league_start_sit_ai"
  | "commentary"
  | "story_creator"
  | "content"
  | "openclaw_dev_assistant"
  | "openclaw_growth_marketing_assistant"
