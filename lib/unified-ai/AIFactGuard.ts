/**
 * AIFactGuard — enforces information-driven AI: no invented values, no gut-feeling as fact.
 * Validates that responses reference deterministic context and don't override hard constraints.
 */

import type { AIContextEnvelope, ModelOutput } from "./types"

interface FactGuardResult {
  allowed: boolean
  warnings: string[]
  suggestedPrefix?: string
}

const INVENTED_PATTERNS = [
  /\b(I think|I feel|my gut|intuition|probably|might be)\s+(that|the)\b/i,
  /\b(without (any )?data|no (numbers|stats)|can't (verify|confirm))\b/i,
  /\b(guaranteed|100%|certain(ly)?)\b/i,
  /\b(invented|made up|guess)\b/i,
]

const GOOD_PATTERNS = [
  /\b(based on (the )?(data|numbers|scores|simulation|rankings))\b/i,
  /\b(the (engine|model|simulation) (shows|says|reports))\b/i,
  /\b(according to (your )?(league|roster|settings))\b/i,
  /\b(confidence is (low|medium|high)|uncertainty)\b/i,
]

/**
 * Check a model output for fact-guard violations (unsupported claims, overriding deterministic).
 */
export function checkFactGuard(
  envelope: AIContextEnvelope,
  output: ModelOutput
): FactGuardResult {
  const warnings: string[] = []
  const text = (output.raw ?? "").trim()

  if (envelope.hardConstraints?.length && text) {
    if (text.toLowerCase().includes("override") || text.toLowerCase().includes("ignore the")) {
      warnings.push("Response may override hard constraints.")
    }
  }

  for (const p of INVENTED_PATTERNS) {
    if (p.test(text)) {
      warnings.push("Response may contain intuition or unverified claims.")
      break
    }
  }

  const hasGood = GOOD_PATTERNS.some((p) => p.test(text))
  if (envelope.deterministicPayload && text.length > 50 && !hasGood && !warnings.length) {
    const hasNumbers = /\d+%|\d+\.\d+|\b(score|probability|rank)\b/i.test(text)
    if (!hasNumbers) {
      warnings.push("Deterministic context was provided but response may not reference specific data.")
    }
  }

  const allowed = warnings.length < 2
  let suggestedPrefix: string | undefined
  if (warnings.length && envelope.confidenceMetadata?.label === "low") {
    suggestedPrefix = "Based on the data we have (confidence is limited): "
  }

  return { allowed, warnings, suggestedPrefix }
}

/**
 * Apply fact guard to a final composed answer; optionally prepend disclaimer.
 */
export function applyFactGuardToAnswer(
  envelope: AIContextEnvelope,
  answer: string
): { answer: string; factGuardWarnings: string[] } {
  const result = checkFactGuard(envelope, { model: "openai", raw: answer })
  let out = answer
  if (result.suggestedPrefix && !answer.startsWith("Based on")) {
    out = result.suggestedPrefix + out
  }
  return { answer: out, factGuardWarnings: result.warnings }
}
