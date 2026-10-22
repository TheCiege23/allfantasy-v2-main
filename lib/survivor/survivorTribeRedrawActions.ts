/**
 * The tribe imbalance rule and the commissioner's three answers to it. Pure: shared by the
 * sit-out engine that raises the recommendation, the decision service that records the answer,
 * and the runner that applies the default when nobody answers.
 */

/** Chimmy, as the actor on automatic decisions and system recommendations. */
export const SURVIVOR_HOST_USER_ID = 'survivor-ai-host'

/** The action row that opens a recommendation (name kept from the sit-out engine that first wrote it). */
export const TRIBE_REDRAW_RECOMMENDATION_ACTION = 'sit_out_shuffle_recommendation'

export const TRIBE_REDRAW_DECISIONS = ['approve', 'postpone', 'manual', 'merge'] as const
export type TribeRedrawDecision = (typeof TRIBE_REDRAW_DECISIONS)[number]

/** The action row that answers a recommendation, per decision. */
export const TRIBE_REDRAW_RESPONSE_ACTION: Record<TribeRedrawDecision, string> = {
  approve: 'sit_out_shuffle_approved',
  postpone: 'sit_out_shuffle_postponed',
  manual: 'sit_out_shuffle_manual',
  merge: 'sit_out_shuffle_merged',
}
export const TRIBE_REDRAW_RESPONSE_ACTIONS: string[] = Object.values(TRIBE_REDRAW_RESPONSE_ACTION)

/** What happens when the commissioner has not answered by the next council: a random redraw. */
export const TRIBE_REDRAW_DEFAULT_DECISION: TribeRedrawDecision = 'approve'

export function isTribeRedrawDecision(value: unknown): value is TribeRedrawDecision {
  return typeof value === 'string' && (TRIBE_REDRAW_DECISIONS as readonly string[]).includes(value)
}

/**
 * The owner's rule: a tribe has fallen below half the size of the largest tribe. Exactly half
 * (4 vs 2) is not below it. Needs two tribes with at least one manager between them.
 */
export function tribeBelowHalfOfLargest(activeSizes: readonly number[]): boolean {
  if (activeSizes.length < 2) return false
  const max = Math.max(...activeSizes)
  const min = Math.min(...activeSizes)
  return max > 0 && min * 2 < max
}
