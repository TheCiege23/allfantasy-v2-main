/**
 * Phase 6F — Compatibility explainability.
 *
 * Produces concise, non-creepy explanation strings + structured tags
 * suitable for the discovery card UI. NEVER references private resume
 * data — only fields visible on the candidate's public DTOs.
 */

import type {
  LeagueFitBreakdown,
  LeagueFitScore,
  LeagueDescriptor,
} from "./types"

const DIMENSION_LABEL: Record<keyof LeagueFitBreakdown, string> = {
  ratingProximity: "Skill",
  difficultyFit: "Difficulty",
  formatOverlap: "Format",
  sportOverlap: "Sport",
  activityAlignment: "Activity",
  reliabilityAlignment: "Reliability",
  competitivenessAlignment: "Competitiveness",
  commissionerFit: "Commissioner fit",
  credibilityFit: "Credibility",
  leagueTypeOverlap: "League type",
}

type ExplanationTag = {
  /** Stable key for analytics / icons. */
  key: keyof LeagueFitBreakdown
  /** Display label. */
  label: string
  /** Score 0..1 for this dimension. */
  value: number
  /** "strong" | "ok" | "weak" — UI uses for chip colour. */
  tier: "strong" | "ok" | "weak"
}

type FitExplanation = {
  /** Short one-line headline (<= 80 chars). */
  headline: string
  /** Top-3 dimensions to render as chips. */
  tags: ExplanationTag[]
  /** Optional caveat line, e.g. "Approximate — low confidence". */
  caveat: string | null
}

function tierFor(v: number): ExplanationTag["tier"] {
  if (v >= 0.75) return "strong"
  if (v >= 0.5) return "ok"
  return "weak"
}

function topDimensions(breakdown: LeagueFitBreakdown, n = 3): Array<keyof LeagueFitBreakdown> {
  return (Object.keys(breakdown) as Array<keyof LeagueFitBreakdown>)
    .sort((a, b) => breakdown[b] - breakdown[a])
    .slice(0, n)
}

/**
 * Build a UI-ready explanation from a fit score. Safe to render on any
 * public surface — no private field is referenced.
 */
export function explainFit(
  score: LeagueFitScore,
  league: LeagueDescriptor
): FitExplanation {
  if (score.hardRejected) {
    return {
      headline: score.rationale,
      tags: [],
      caveat: null,
    }
  }

  const keys = topDimensions(score.breakdown, 3)
  const tags: ExplanationTag[] = keys.map((k) => ({
    key: k,
    label: DIMENSION_LABEL[k],
    value: score.breakdown[k],
    tier: tierFor(score.breakdown[k]),
  }))

  const headline = score.rationale || "Solid overall match."
  const caveat = score.confidence < 0.5 ? "Approximate — low signal" : null
  // The league reference is currently advisory; it lets us in the future
  // append "in NFL Dynasty leagues" etc. without changing the contract.
  void league
  return { headline, tags, caveat }
}

/** Short "X% fit" string for compact chips. */
export function formatFitPercent(score: number): string {
  const pct = Math.max(0, Math.min(1, score))
  return `${Math.round(pct * 100)}% fit`
}
