/**
 * Canonical scoring-mode identifier persisted on league settings as
 * `settings.scoring_mode`. Default `'points'` keeps existing behavior for every
 * pre-existing league. `'h2h_category'` activates the weekly category matchup
 * path (weeklyProcessor + matchupEngine branches, added in a later turn).
 * `'roto'` is scaffolded but not yet implemented.
 */
export type ScoringMode = 'points' | 'h2h_category' | 'roto'

export const SCORING_MODES = ['points', 'h2h_category', 'roto'] as const

export function isScoringMode(value: unknown): value is ScoringMode {
  return (
    typeof value === 'string' &&
    (SCORING_MODES as readonly string[]).includes(value)
  )
}

/**
 * Canonical category-preset id. Extend this union as MLB/NHL presets land.
 * The preset id lives on league settings as `settings.category_preset_id` and
 * resolves to a category definition list at runtime via
 * `getCategoryPresetDefinitions(id)`.
 */
export type CategoryPresetId = 'nba_8cat' | 'nba_9cat' | 'mlb_5x5' | 'mlb_6x6'

export const CATEGORY_PRESET_IDS = ['nba_8cat', 'nba_9cat', 'mlb_5x5', 'mlb_6x6'] as const

export function isCategoryPresetId(value: unknown): value is CategoryPresetId {
  return (
    typeof value === 'string' &&
    (CATEGORY_PRESET_IDS as readonly string[]).includes(value)
  )
}

/**
 * Shared types for category (roto / H2H-categories) fantasy scoring.
 *
 * Category formats compete teams across N independent statistical categories
 * rather than summing everything into a single point total:
 *   - H2H-category: weekly matchup; each category independently won/lost/tied.
 *     Match result is a tuple like 6-3-0 (wins-losses-ties).
 *   - Roto: cumulative season ranks per category across the whole league.
 *
 * These types describe the comparison layer only — no DB, no API, no UI.
 * Integration into the weekly processor / standings engine comes in later
 * turns; see lib/category-scoring/CategoryMatchupResolver.ts for the first
 * consumer.
 */

/**
 * Direction a category is optimized.
 * - `higher`: team with the larger value wins (PTS, REB, AST…)
 * - `lower`:  team with the smaller value wins (TO, GAA, ERA, WHIP…)
 */
export type CategoryDirection = 'higher' | 'lower'

/** How a category's value is derived from the raw per-player stat map. */
export type CategoryComputation =
  | { kind: 'sum'; statKey: string }
  | {
      /**
       * Ratio category (FG%, FT%, AVG, etc.). Value = sum(num) / sum(den).
       * Division by zero short-circuits to 0 (never yields NaN/Infinity).
       */
      kind: 'ratio'
      numeratorStatKey: string
      additionalNumeratorStatKeys?: string[]
      multiplier?: number
      /** Undefined preserves NBA's existing zero-denominator semantics. */
      unqualifiedWhenZero?: boolean
      denominatorStatKey: string
    }

export interface CategoryDefinition {
  /** Stable id used in league settings, API payloads, test fixtures. */
  id: string
  /** Short display label ("PTS", "FG%"). */
  label: string
  /** Longer description for tooltips / settings UI (optional). */
  description?: string
  direction: CategoryDirection
  computation: CategoryComputation
}

/** Aggregated stat values for one team in one matchup period. */
export type TeamStatTotals = Record<string, number>

export interface CategoryMatchupCategoryResult {
  categoryId: string
  label: string
  aValue: number | null
  bValue: number | null
  /** 'a' | 'b' | 'tie' */
  winner: 'a' | 'b' | 'tie'
}

export interface CategoryMatchupResult {
  /** Per-category breakdown in the same order as the category list. */
  categories: CategoryMatchupCategoryResult[]
  aWins: number
  bWins: number
  ties: number
}
