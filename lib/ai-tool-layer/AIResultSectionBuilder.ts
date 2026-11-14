/**
 * AIResultSectionBuilder — builds verdict, evidence, confidence, risks, next action, alternate from raw AI + deterministic context.
 * Ensures no vague or unsupported sections; evidence must come from context.
 */

import type { ToolOutput } from "./types"
import type { AIContextEnvelope } from "@/lib/unified-ai/types"

export interface BuildSectionsInput {
  primaryAnswer: string
  structured?: Record<string, unknown> | null
  envelope: AIContextEnvelope
  toolKey: string
  /** Pre-extracted evidence strings from deterministic payload (so we don't invent). */
  deterministicEvidence?: string[]
}

/**
 * Normalize confidence from number or object to ToolOutput confidence shape.
 */
function normalizeConfidence(
  v: number | { label: string; pct?: number } | undefined
): ToolOutput["confidence"] {
  if (v == null) return { label: "medium", pct: 50 }
  if (typeof v === "number") return v
  const label = v.label === "low" || v.label === "medium" || v.label === "high" ? v.label : "medium"
  return { label, pct: v.pct }
}

/**
 * Build ToolOutput from primary answer, structured AI response, and envelope.
 * Pulls evidence from deterministicEvidence or structured; does not invent.
 */
export function buildToolOutputSections(input: BuildSectionsInput): ToolOutput {
  const { primaryAnswer, structured, envelope, deterministicEvidence = [] } = input
  const st = structured ?? {}

  const verdict =
    (st.verdict as string) ??
    (st.recommendation as string) ??
    primaryAnswer.split("\n")[0]?.trim() ??
    "See analysis below."

  const evidenceFromStructured: string[] = []
  if (Array.isArray(st.keyEvidence)) {
    evidenceFromStructured.push(...(st.keyEvidence as string[]).slice(0, 8))
  }
  if (Array.isArray(st.evidence)) {
    evidenceFromStructured.push(...(st.evidence as string[]).slice(0, 8))
  }
  const keyEvidence = deterministicEvidence.length
    ? deterministicEvidence.slice(0, 8)
    : evidenceFromStructured.length
      ? evidenceFromStructured
      : [primaryAnswer.slice(0, 200)]

  const confidence = normalizeConfidence(
    (st.confidence as number) ??
      (st.confidencePct as number) ??
      envelope.confidenceMetadata?.score ??
      (envelope.confidenceMetadata?.label ? { label: envelope.confidenceMetadata.label as "low" | "medium" | "high", pct: undefined } : undefined)
  )

  const risksFromStructured: string[] = []
  if (Array.isArray(st.risks)) risksFromStructured.push(...(st.risks as string[]))
  if (Array.isArray(st.caveats)) risksFromStructured.push(...(st.caveats as string[]))
  if (Array.isArray(st.risksCaveats)) risksFromStructured.push(...(st.risksCaveats as string[]))
  const risksCaveats =
    risksFromStructured.length > 0
      ? risksFromStructured.slice(0, 5)
      : envelope.dataQualityMetadata?.stale
        ? ["Underlying data may be stale."]
        : envelope.dataQualityMetadata?.missing?.length
          ? ["Some context was missing: " + envelope.dataQualityMetadata.missing.slice(0, 3).join(", ")]
          : []

  const suggestedNextAction =
    (st.suggestedNextAction as string) ??
    (st.nextAction as string) ??
    (st.action as string) ??
    "Review the evidence above and your league settings before deciding."

  const alternatePath = (st.alternatePath as string) ?? (st.alternate as string)

  return {
    verdict,
    keyEvidence,
    confidence,
    risksCaveats,
    suggestedNextAction,
    alternatePath: alternatePath || undefined,
    narrative: primaryAnswer,
  }
}
