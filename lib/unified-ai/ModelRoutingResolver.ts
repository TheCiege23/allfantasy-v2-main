/**
 * ModelRoutingResolver — decides which model(s) to use from envelope and mode.
 * Aligns with 3-AI responsibility model: OpenAI (explanation/UX), DeepSeek (analytical), Grok (narrative/trends).
 */

import type { AIContextEnvelope, AIModelRole, OrchestrationMode } from "./types"

/** Which role each model fulfills. */
export const MODEL_RESPONSIBILITIES: Record<
  AIModelRole,
  { primary: string; bestFor: string[] }
> = {
  openai: {
    primary: "Final user-facing explanation, natural language, action plans, Chimmy voice.",
    bestFor: ["explanation", "chat", "guidance", "synthesis", "voice"],
  },
  deepseek: {
    primary: "Structured analytical reasoning, stats interpretation, numeric review, deterministic context.",
    bestFor: ["analysis", "numbers", "projections", "matrix_review", "decision_support"],
  },
  grok: {
    primary: "Trend interpretation, narrative framing, social/summary, league story, engagement.",
    bestFor: ["trends", "narrative", "social", "story", "engagement"],
  },
  anthropic: {
    primary:
      "Chimmy's main model (2026-09-23): answers first in the tool loop and on the push path; the other three are Chimmy's fallback. Not routed to by other features.",
    bestFor: ["chat", "explanation", "analysis", "synthesis", "tool_use"],
  },
}

/** Assistant responsibilities outside core 3-model execution. */
export const ASSISTANT_RESPONSIBILITIES = {
  chimmy:
    "Calm, natural chat surface for private fantasy guidance using unified orchestration context.",
  openclaw_dev_assistant:
    "Workflow assistant endpoint for engineering and platform operations support.",
  openclaw_growth_marketing_assistant:
    "Workflow assistant endpoint for growth and marketing execution support.",
} as const

const QUANT_PATTERNS = [
  "math",
  "projection",
  "projections",
  "probability",
  "expected value",
  "ev",
  "ranking validation",
  "rankings validation",
  "rank validation",
  "adp",
  "simulation",
  "simulate",
  "score model",
  "optimize",
] as const

const TONE_PATTERNS = [
  "personality",
  "engagement",
  "tone",
  "hype",
  "banter",
  "narrative",
  "story",
  "social",
  "funny",
] as const

const CONVERSATIONAL_PATTERNS = [
  "coach",
  "coaching",
  "explain",
  "explanation",
  "chat",
  "what should i do",
  "help me",
  "advice",
] as const

const MULTI_MODEL_PATTERNS = [
  "consensus",
  "compare models",
  "all models",
  "multi-model",
  "cross-model",
  "verify across models",
] as const

function hasPattern(text: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern))
}

function getRoutingSignals(envelope: AIContextEnvelope): {
  wantsQuant: boolean
  wantsTone: boolean
  wantsConversational: boolean
  wantsMultiModel: boolean
} {
  const text = [
    envelope.featureType ?? "",
    envelope.promptIntent ?? "",
    envelope.userMessage ?? "",
    ...(envelope.hardConstraints ?? []),
  ]
    .join(" ")
    .toLowerCase()

  const feature = (envelope.featureType ?? "").toLowerCase()
  const intent = (envelope.promptIntent ?? "").toLowerCase()

  const wantsQuant =
    hasPattern(text, QUANT_PATTERNS) ||
    feature.includes("rankings") ||
    feature.includes("simulation") ||
    feature.includes("matchup") ||
    intent === "calculate" ||
    intent === "analyze"

  const wantsTone =
    hasPattern(text, TONE_PATTERNS) ||
    feature.includes("story") ||
    feature.includes("rivalry") ||
    feature.includes("content")

  const wantsConversational =
    hasPattern(text, CONVERSATIONAL_PATTERNS) ||
    feature.includes("chimmy") ||
    feature.includes("chat") ||
    intent === "explain" ||
    intent === "summarize"

  const wantsMultiModel =
    hasPattern(text, MULTI_MODEL_PATTERNS) ||
    intent === "compare" ||
    intent === "consensus"

  return { wantsQuant, wantsTone, wantsConversational, wantsMultiModel }
}

/**
 * Resolve orchestration mode from envelope or default.
 */
export function resolveOrchestrationMode(
  envelope: AIContextEnvelope,
  defaultMode: OrchestrationMode = "single_model"
): OrchestrationMode {
  const intent = (envelope.promptIntent ?? "").toLowerCase()
  const feature = (envelope.featureType ?? "").toLowerCase()
  const signals = getRoutingSignals(envelope)

  if (envelope.modelRoutingHints?.length === 1) return "single_model"
  if (signals.wantsMultiModel) return "consensus"
  if (signals.wantsQuant && signals.wantsConversational) return "specialist"
  if (signals.wantsQuant && signals.wantsTone) return "consensus"
  if (intent === "explain" && envelope.deterministicPayload) return "specialist"
  if (feature === "graph_insight" || feature === "bracket_intelligence") return "consensus"
  if (feature === "chimmy_chat") {
    return signals.wantsQuant || signals.wantsTone ? "specialist" : "single_model"
  }

  return defaultMode
}

/**
 * For single-model mode: which model to use from envelope hints or feature.
 */
export function resolveSingleModel(
  envelope: AIContextEnvelope
): AIModelRole {
  const hint = envelope.modelRoutingHints?.[0]
  if (hint) return hint

  const signals = getRoutingSignals(envelope)
  if (signals.wantsQuant) return "deepseek"
  if (signals.wantsTone) return "grok"

  return "openai"
}

/**
 * For specialist mode: which model for "computation/analysis" and which for "explanation".
 */
export function resolveSpecialistPair(
  envelope: AIContextEnvelope
): { analysis: AIModelRole; explanation: AIModelRole } {
  const hints = envelope.modelRoutingHints ?? []
  if (hints.length >= 2) return { analysis: hints[0], explanation: hints[1] }
  const signals = getRoutingSignals(envelope)
  if (signals.wantsTone && !signals.wantsQuant) {
    return { analysis: "grok", explanation: "openai" }
  }
  return { analysis: "deepseek", explanation: "openai" }
}

/**
 * For consensus or unified_brain: which models to run (all three by default).
 */
export function resolveModelsForConsensus(
  envelope: AIContextEnvelope
): AIModelRole[] {
  const hints = envelope.modelRoutingHints
  if (hints?.length) return [...new Set(hints)]
  const signals = getRoutingSignals(envelope)

  // Explicit consensus requests get all three.
  if (signals.wantsMultiModel) {
    return ["deepseek", "grok", "openai"]
  }

  // Math-heavy + explanation: analysis + synthesis.
  if (signals.wantsQuant && signals.wantsConversational) {
    return ["deepseek", "openai"]
  }

  // Quant + personality/tone: analysis + tone (+ synthesis if needed by caller mode).
  if (signals.wantsQuant && signals.wantsTone) {
    return ["deepseek", "grok", "openai"]
  }

  // Personality/engagement drafting with optional synthesis.
  if (signals.wantsTone) {
    return ["grok", "openai"]
  }

  // Conversational/explanatory fallback.
  return ["openai"]
}
