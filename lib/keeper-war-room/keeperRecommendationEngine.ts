/**
 * KEEPER RECOMMENDATION ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Picks the BEST keeper set for a roster within the league's keeper limit, ranked by
 * value surplus (and per-position caps if configured). Returns the recommended keep set,
 * the bubble (next-best just outside the limit), and a limited-data flag when keeper cost
 * or value is unavailable. Honest: never invents costs or values.
 */

import { rankKeepers, type KeeperValueLine } from './keeperValueEngine'
import type { KeeperWarRoomContext } from './types'

export interface KeeperRecommendationResult {
  rosterId: string
  maxKeepers: number
  /** Best keep set within the limit (eligible, valued, positive/standout surplus first). */
  recommended: KeeperValueLine[]
  /** Next-best candidates just outside the limit. */
  bubble: KeeperValueLine[]
  /** Eligible candidates with negative surplus you should NOT keep. */
  avoid: KeeperValueLine[]
  /** All classified candidates (sorted). */
  ranked: KeeperValueLine[]
  needsMoreData: boolean
  missingDataFlags: string[]
}

export function recommendKeepers(context: KeeperWarRoomContext, rosterId: string): KeeperRecommendationResult {
  const missingDataFlags = [...context.missingDataFlags]
  const maxKeepers = Math.max(0, context.keeper.maxKeepers)
  const ranked = rankKeepers(context, rosterId)

  if (!context.featureAvailability.keeperRecommendations) {
    return {
      rosterId,
      maxKeepers,
      recommended: [],
      bubble: [],
      avoid: [],
      ranked,
      needsMoreData: true,
      missingDataFlags: [
        ...new Set([
          ...missingDataFlags,
          'Keeper recommendations need both ADP/value and keeper cost data; one or both are unavailable.',
        ]),
      ],
    }
  }

  // Only eligible, value-known candidates are keepable; rank by surplus desc.
  const keepable = ranked.filter((r) => r.verdict !== 'ineligible' && r.verdict !== 'no_cost')
  const recommended = keepable.slice(0, maxKeepers)
  const bubble = keepable.slice(maxKeepers).filter((r) => (r.surplusRounds ?? 0) >= 0).slice(0, 3)
  const avoid = keepable.filter((r) => (r.surplusRounds ?? 0) < 0)

  if (keepable.some((r) => r.verdict === 'no_cost')) {
    missingDataFlags.push('Some players lack keeper-cost data and were excluded from the ranking.')
  }

  return {
    rosterId,
    maxKeepers,
    recommended,
    bubble,
    avoid,
    ranked,
    needsMoreData: false,
    missingDataFlags: [...new Set(missingDataFlags)],
  }
}
