/**
 * ConsensusEvaluator — compares multiple model outputs and picks or merges primary answer.
 * Used in consensus and unified_brain modes; prefers OpenAI for final text when available.
 */

import type { ModelOutput, OrchestrationResult } from "./types"
import type { AIModelRole } from "./types"

export interface ConsensusInput {
  modelOutputs: ModelOutput[]
  preferModel?: AIModelRole
  deterministicSummary?: string
}

/**
 * Select or merge primary answer from model outputs.
 * Rule: Prefer OpenAI for user-facing text; fall back to Grok then DeepSeek; never invent.
 */
export function evaluateConsensus(input: ConsensusInput): {
  primaryAnswer: string
  reason: string
  usedModels: AIModelRole[]
} {
  const { modelOutputs, preferModel = "openai", deterministicSummary } = input
  const byModel = new Map<AIModelRole, string>()
  for (const o of modelOutputs) {
    if (!o.skipped && !o.error && o.raw?.trim()) byModel.set(o.model, o.raw.trim())
  }

  const order: AIModelRole[] = preferModel
    ? [preferModel, ...(["openai", "grok", "deepseek"] as const).filter((m) => m !== preferModel)]
    : ["openai", "grok", "deepseek"]

  for (const m of order) {
    const text = byModel.get(m)
    if (text) {
      return {
        primaryAnswer: text,
        reason: `Primary from ${m}.`,
        usedModels: Array.from(byModel.keys()),
      }
    }
  }

  if (deterministicSummary) {
    return {
      primaryAnswer: "Based on the data: " + deterministicSummary.slice(0, 300),
      reason: "Deterministic-only (no model output available).",
      usedModels: [],
    }
  }

  return {
    primaryAnswer: "I couldn't complete the analysis right now. Please try again or check your data.",
    reason: "No model output available.",
    usedModels: [],
  }
}

