/**
 * AIConfidenceResolver — derives confidence label and percentage from deterministic + model outputs.
 * Ensures we surface "confidence is limited" when appropriate.
 */

import type { AIContextEnvelope, ModelOutput } from "./types"

export type ConfidenceLabel = "low" | "medium" | "high"

export interface ConfidenceResult {
  label: ConfidenceLabel
  scorePct: number
  reason?: string
}

/**
 * Resolve confidence from envelope metadata (deterministic layer) and optional model outputs.
 */
export function resolveConfidence(
  envelope: AIContextEnvelope,
  modelOutputs?: ModelOutput[]
): ConfidenceResult {
  const meta = envelope.confidenceMetadata
  const dataQuality = envelope.dataQualityMetadata

  if (meta?.score != null && meta.score >= 0 && meta.score <= 100) {
    const label = scoreToLabel(meta.score)
    return {
      label,
      scorePct: meta.score,
      reason: meta.reason ?? meta.label,
    }
  }

  if (dataQuality?.stale) {
    return { label: "low", scorePct: 35, reason: "Underlying data may be stale." }
  }
  if (dataQuality?.missing?.length) {
    return { label: "medium", scorePct: 55, reason: "Some context missing: " + dataQuality.missing.slice(0, 3).join(", ") }
  }

  if (envelope.deterministicPayload) {
    return { label: "medium", scorePct: 65, reason: "Based on deterministic output; interpretation may vary." }
  }

  const anyError = modelOutputs?.some((o) => o.error || o.skipped)
  if (anyError) {
    return { label: "low", scorePct: 45, reason: "One or more models failed or were skipped." }
  }

  return { label: "medium", scorePct: 60, reason: "Multi-model consensus." }
}

function scoreToLabel(pct: number): ConfidenceLabel {
  if (pct >= 75) return "high"
  if (pct >= 50) return "medium"
  return "low"
}

