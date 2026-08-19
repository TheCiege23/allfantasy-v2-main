/**
 * Decision OS — Today Card compatibility adapter (Slice 1).
 *
 * Lets the EXISTING Today lineup UI consume the new Decision Object without a UI rewrite:
 *   - the per-slot items are already `LineupActionItem[]` (what the UI renders today), carried
 *     unchanged on the Decision;
 *   - a richer card header is derived from the four answers.
 * `/api/today/lineup-actions` stays payload-compatible (it can still return the legacy summary; this
 * only enriches the single-league card when the Decision OS path is active).
 */
import type { LineupActionItem } from '@/lib/lineup-actions/types'
import type { Decision } from '@/lib/decision-os/core/decision'

export interface LineupTodayCard {
  title: string
  why: string
  cta: string
  confidenceLabel: string
  severity: 'critical' | 'warning' | 'info'
  count: number
  /** The existing UI already knows how to render these. */
  actions: LineupActionItem[]
  empty: boolean
}

/** The per-slot items the existing UI consumes — unchanged from the canonical recommender. */
export function decisionRecommendedActions(decision: Decision<LineupActionItem>): LineupActionItem[] {
  return decision.recommended_actions
}

/** Decision Object → Today card view-model (header from the four answers; body = existing items). */
export function toTodayLineupCard(decision: Decision<LineupActionItem>): LineupTodayCard {
  const actions = decision.recommended_actions
  const empty = actions.length === 0
  const severity: LineupTodayCard['severity'] = actions.some((a) => a.severity === 'critical')
    ? 'critical'
    : actions.some((a) => a.severity === 'warning')
      ? 'warning'
      : 'info'
  return {
    title: decision.four_answers.what_happened,
    why: decision.four_answers.why_it_matters,
    cta: decision.four_answers.what_to_do,
    confidenceLabel: decision.four_answers.how_confident,
    severity: empty ? 'info' : severity,
    count: actions.length,
    actions,
    empty,
  }
}
