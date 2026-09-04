/**
 * Fantasy OS Phase 4 — explanation contract (Part 5).
 *
 * Every executive insight/recommendation is a fully-populated, DETERMINISTIC object. There is no LLM in
 * this path: an insight is computed by a pure function and formatted by a deterministic formatter. A
 * recommendation may NOT render unless every required field is present (enforced by `isRenderableInsight`).
 */
import type { TruthLabel } from './truth'

export type EvidenceItem = {
  /** The deterministic metric this evidence draws from (traceable). */
  metric: string
  value: number | string
  detail?: string
}

export type ConfidenceLevel = 'High' | 'Medium' | 'Low'

export type Explanation = {
  whatHappened: string
  evidence: EvidenceItem[]
  whyItMatters: string
  recommendation: string
  confidence: { level: ConfidenceLevel; rationale: string }
  truthLabel: TruthLabel
  limitations?: string[]
}

/** A recommendation must not render with any required field missing/empty. */
export function isRenderableInsight(x: Explanation | null | undefined): x is Explanation {
  if (!x) return false
  const nonEmpty = (s: unknown) => typeof s === 'string' && s.trim().length > 0
  return (
    nonEmpty(x.whatHappened) &&
    Array.isArray(x.evidence) &&
    x.evidence.length > 0 &&
    x.evidence.every((e) => nonEmpty(e.metric) && (typeof e.value === 'number' || nonEmpty(e.value))) &&
    nonEmpty(x.whyItMatters) &&
    nonEmpty(x.recommendation) &&
    !!x.confidence &&
    (x.confidence.level === 'High' || x.confidence.level === 'Medium' || x.confidence.level === 'Low') &&
    nonEmpty(x.confidence.rationale) &&
    isTruthLabel(x.truthLabel)
  )
}

function isTruthLabel(v: unknown): v is TruthLabel {
  return (
    v === 'Live League Data' ||
    v === 'Derived League Intelligence' ||
    v === 'Presentation Preview' ||
    v === 'Insufficient Evidence'
  )
}

/**
 * Confidence from evidence sufficiency (deterministic): High ≥ highN sampled units, Medium ≥ medN, else Low.
 * This is the single confidence rule reused across workspaces so the meaning is consistent.
 */
export function confidenceFromSampleSize(
  n: number,
  opts: { highN?: number; medN?: number; unit?: string } = {},
): { level: ConfidenceLevel; rationale: string } {
  const highN = opts.highN ?? 100
  const medN = opts.medN ?? 20
  const unit = opts.unit ?? 'records'
  if (n >= highN) return { level: 'High', rationale: `Based on ${n.toLocaleString()} ${unit}.` }
  if (n >= medN) return { level: 'Medium', rationale: `Based on ${n.toLocaleString()} ${unit} (moderate sample).` }
  return { level: 'Low', rationale: `Based on only ${n.toLocaleString()} ${unit} (small sample).` }
}
