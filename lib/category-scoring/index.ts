/**
 * Public surface for category-scoring consumers. Importers should pull from
 * this module rather than reaching into individual files — it lets us keep
 * the NBA-only starter registry here and expand later (MLB, NHL) without
 * rewriting call sites.
 */

import type { CategoryDefinition, CategoryPresetId } from './types'
import { MLB_FIVE_BY_FIVE, MLB_SIX_BY_SIX } from './MlbCategoryRegistry'
import { NBA_EIGHT_CAT, NBA_NINE_CAT } from './NbaCategoryRegistry'

export * from './types'
export * from './NbaCategoryRegistry'
export * from './MlbCategoryRegistry'
export * from './CategoryMatchupResolver'

/**
 * Map a persisted category-preset id to its category list. Returns null when
 * the id is unknown (callers should treat unknown presets as "no category
 * scoring" and fall back to points).
 */
export function getCategoryPresetDefinitions(
  presetId: CategoryPresetId | string | null | undefined,
): readonly CategoryDefinition[] | null {
  if (presetId === 'mlb_5x5') return MLB_FIVE_BY_FIVE
  if (presetId === 'mlb_6x6') return MLB_SIX_BY_SIX
  if (presetId === 'nba_8cat') return NBA_EIGHT_CAT
  if (presetId === 'nba_9cat') return NBA_NINE_CAT
  return null
}
