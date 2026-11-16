/**
 * worldCupAiShareCard.ts
 *
 * Pure deterministic helper that composes 6 existing World Cup AI insights
 * into one shareable text card:
 *   1. Bracket Grade
 *   2. Champion Confidence
 *   3. AI Win Probability
 *   4. Rooting Guide (top recommendation)
 *   5. Uniqueness insight (rarest pick)
 *   6. Explain My Bracket summary (deterministic, derived from grade)
 *
 * No LLM call. No external fetch. No PII (own bracket data + aggregated
 * pool counts only). The helper itself does no I/O — the component
 * gathers each insight from existing helpers/state and passes it in.
 */
import type { WorldCupBracketGradeInsight } from "./worldCupAiSubscriptionInsights"
import type { RootingRecommendation } from "./worldCupRootingGuide"
import type { UniquenessInsight } from "./worldCupUniquenessInsights"

type WorldCupAiShareCardStatus =
  | "ready"
  | "no_entry"
  | "incomplete"

export type WorldCupAiShareCardResult = {
  title: string
  status: WorldCupAiShareCardStatus
  lines: string[]
  shareText: string
  lockedLines?: string[]
}

export type BuildWorldCupAiShareCardInput = {
  poolName: string
  entryName: string | null
  championName: string | null
  isComplete: boolean
  /** Deterministic bracket grade insight (always available). */
  grade: WorldCupBracketGradeInsight | null
  /** Top rooting recommendation for today/upcoming (optional). */
  topRootingRec?: RootingRecommendation | null
  /** AI Win Probability percentage 0-100 for this entry (optional). */
  aiWinProbabilityPct?: number | null
  /** Top uniqueness insight for the bracket (optional, requires pool data). */
  topUniquenessInsight?: UniquenessInsight | null
  /** AF Pro entitlement. Free users get a preview + upgrade lock line. */
  hasBracketBrainAi?: boolean
}

const POWERED_BY = "Powered by AllFantasy."
const SHARE_TITLE = "My AllFantasy World Cup AI Bracket Card"

const FORBIDDEN_TERMS = [
  /\bdfs\b/gi,
  /\bbetting\b/gi,
  /\bwager(?:ing|s|ed)?\b/gi,
  /\bsportsbook\b/gi,
  /\bodds\b/gi,
]

/** Strips wagering/betting copy so the share text stays brand-safe. */
function sanitizeLine(line: string): string {
  let cleaned = line
  for (const pattern of FORBIDDEN_TERMS) {
    cleaned = cleaned.replace(pattern, "prediction")
  }
  return cleaned.replace(/\s+/g, " ").trim()
}

/** Returns a short deterministic "explain summary" line derived from grade + champion. */
function deterministicExplainSummary(input: {
  championName: string | null
  grade: WorldCupBracketGradeInsight | null
}): string | null {
  const { championName, grade } = input
  if (!championName && !grade) return null
  const champLabel = championName ?? "no champion selected"
  if (!grade) return `Built around ${champLabel}.`
  const tone =
    grade.riskLabel === "High"
      ? "high-variance bracket"
      : grade.riskLabel === "Low"
      ? "chalky bracket"
      : "balanced bracket"
  return `Style: ${tone} built around ${champLabel}.`
}

export function buildWorldCupAiBracketShareCard(
  input: BuildWorldCupAiShareCardInput
): WorldCupAiShareCardResult {
  const {
    poolName,
    entryName,
    championName,
    isComplete,
    grade,
    topRootingRec,
    aiWinProbabilityPct,
    topUniquenessInsight,
    hasBracketBrainAi = false,
  } = input

  if (!entryName) {
    return {
      title: SHARE_TITLE,
      status: "no_entry",
      lines: [],
      shareText: "Select a bracket entry to generate a share card.",
    }
  }

  const explainSummary = deterministicExplainSummary({ championName, grade })

  // Build base lines used by both Free and Pro.
  const baseLines: string[] = []
  baseLines.push(`My AllFantasy World Cup Bracket — ${poolName}`)
  baseLines.push(`${entryName}${isComplete ? " — Locked in" : " — In progress"}`)
  if (grade) {
    baseLines.push(
      `Bracket Grade: ${grade.grade} (${grade.completionPercent}% complete, ${grade.riskLabel.toLowerCase()} risk)`
    )
  }
  if (championName) {
    baseLines.push(`Champion: ${championName}`)
  }
  if (explainSummary) {
    baseLines.push(explainSummary)
  }

  // Free preview ends here + upgrade CTA.
  if (!hasBracketBrainAi) {
    const lines = baseLines.slice()
    lines.push(POWERED_BY)
    const lockedLines = [
      "AF Pro unlocks Champion Confidence, AI Win Probability, today's rooting pick, and your uniqueness insight on this card.",
    ]
    return {
      title: SHARE_TITLE,
      status: isComplete ? "ready" : "incomplete",
      lines: lines.map(sanitizeLine),
      shareText: sanitizeLine(lines.join("\n")),
      lockedLines,
    }
  }

  // Pro: append the remaining four Pro-only signals when available.
  const proLines = baseLines.slice()

  if (grade && grade.championSelected) {
    proLines.push(`Champion Confidence: ${grade.championConfidence}%`)
  }

  if (typeof aiWinProbabilityPct === "number" && Number.isFinite(aiWinProbabilityPct)) {
    const pct = Math.max(0, Math.min(100, Math.round(aiWinProbabilityPct)))
    proLines.push(`AI Win Probability: ${pct}%`)
  }

  if (topRootingRec) {
    proLines.push(
      `Today: Root for ${topRootingRec.teamName} — ${topRootingRec.tag} (${topRootingRec.impact} impact)`
    )
  }

  if (topUniquenessInsight) {
    const pctSegment =
      typeof topUniquenessInsight.percentage === "number"
        ? ` (${topUniquenessInsight.percentage}% of finalized brackets)`
        : ""
    proLines.push(`Uniqueness: ${topUniquenessInsight.label}${pctSegment}`)
  }

  proLines.push(POWERED_BY)

  return {
    title: SHARE_TITLE,
    status: isComplete ? "ready" : "incomplete",
    lines: proLines.map(sanitizeLine),
    shareText: sanitizeLine(proLines.join("\n")),
  }
}
