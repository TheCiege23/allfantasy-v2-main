/**
 * Fantasy OS Suite — Phase V4.0: shared recommendation-presentation helpers.
 *
 * The single source of truth for how the executive view models turn Decision OS ordinals into the
 * shared executive status vocabulary and display labels. Extracted in the Architecture & Launch
 * Readiness Review after these byte-identical helpers were found duplicated across 5 view models
 * (`PRIORITY_RANK` + `statusFromPriority` × 5, `titleCase` × 4, `statusFromScore` / `statusFromSeverity`
 * × 2). Consolidating them enforces that every workspace maps priority/severity/score to status
 * IDENTICALLY — a semantic-consistency guarantee, not just DRY.
 *
 * Presentation-only: pure functions over Decision OS contract TYPES, no runtime Decision OS logic, no
 * providers, no side effects.
 */
import type { RecommendationPriority } from '@/lib/decision-os/phase6/recommendations/types'
import type { AttentionSignalSeverity } from '@/lib/decision-os/attentionSignals'
import type { ExecutiveHealthStatus } from './commissionerLeagueHealthViewModel'

/** Priority ordering for "highest priority first" sorts. */
export const PRIORITY_RANK: Record<RecommendationPriority, number> = { critical: 4, high: 3, medium: 2, low: 1 }

/** Recommendation priority → executive status. The one mapping every workspace shares. */
export function statusFromPriority(priority: RecommendationPriority): ExecutiveHealthStatus {
  switch (priority) {
    case 'critical':
      return 'critical'
    case 'high':
      return 'at_risk'
    case 'medium':
      return 'watch'
    default:
      return 'healthy'
  }
}

/** Attention-signal severity → executive status. */
export function statusFromSeverity(severity: AttentionSignalSeverity): ExecutiveHealthStatus {
  switch (severity) {
    case 'critical':
      return 'critical'
    case 'high':
      return 'at_risk'
    case 'medium':
      return 'watch'
    case 'low':
      return 'healthy'
    default:
      return 'excellent'
  }
}

/** 0–100 score → executive status. Shared thresholds for every score-backed dimension/gauge. */
export function statusFromScore(score: number): ExecutiveHealthStatus {
  if (score >= 80) return 'excellent'
  if (score >= 65) return 'healthy'
  if (score >= 50) return 'watch'
  if (score >= 35) return 'at_risk'
  return 'critical'
}

/** snake_case / kebab-case / spaced → Title Case, for turning categories into plain-language labels. */
export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase())
}
