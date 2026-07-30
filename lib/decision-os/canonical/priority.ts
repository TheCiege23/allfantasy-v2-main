/**
 * Deterministic 0–100 priority score for a canonical decision (Phase 3A). PURE. Server-computed so the surface
 * layer never trusts a producer-supplied ranking. Weighted blend of severity, urgency, and confidence — no
 * provider call, no side effects.
 */
import type { DecisionSeverity, DecisionUrgency } from './contract'

const SEVERITY_WEIGHT: Record<DecisionSeverity, number> = {
  info: 5,
  low: 25,
  medium: 50,
  high: 78,
  critical: 100,
}
const URGENCY_WEIGHT: Record<DecisionUrgency, number> = {
  none: 0,
  this_week: 40,
  today: 75,
  now: 100,
}

/** Blend: 55% severity, 30% urgency, 15% confidence. Clamped to [0,100], rounded. */
export function computePriorityScore(input: {
  severity: DecisionSeverity
  urgency: DecisionUrgency
  confidencePct?: number | null
}): number {
  const sev = SEVERITY_WEIGHT[input.severity] ?? 0
  const urg = URGENCY_WEIGHT[input.urgency] ?? 0
  const conf = typeof input.confidencePct === 'number' ? Math.max(0, Math.min(100, input.confidencePct)) : 50
  const score = sev * 0.55 + urg * 0.3 + conf * 0.15
  return Math.max(0, Math.min(100, Math.round(score)))
}
