/**
 * Category scoring for the sports whose production is not football.
 *
 * WHY THIS EXISTS. `buildAfProjection` had four scoring bases and every one of them was
 * football-shaped: a Sleeper weekly projection, weekly points in ppr/half_ppr/std, the provider's
 * `DK_fantasy_points_per_game`, and IDP components. So when the multi-sport pipeline finally
 * delivered stat lines — measured on production 2026-08-27: MLB 2,553, NCAAB 4,732, NHL 1,040,
 * NBA 591 — the engine READ every one of them and refused every one of them, overwhelmingly
 * `no_scoring_basis`. It was refusing correctly. There was no basis to apply, because
 * `scoring_templates` and `sport_configs` are both EMPTY in production.
 *
 * ⚠ RULES ARE A PRODUCT DECISION, AND THESE ARE DEFAULTS, NOT LAWS. A real league scores what its
 * commissioner says it scores. What these give is a defensible baseline so a projection can exist
 * at all; `rescoreForLeague` remains the path for a league's own settings.
 *
 * SOCCER is the only supported sport with no rules here, and that is not squeamishness: the vendor
 * serves no player season stats for it at all, so there is nothing to score. NCAAB shares NBA's
 * rules because it shares NBA's measured stat vocabulary — see RULES_BY_SPORT.
 *
 * WHY DRAFTKINGS CONVENTIONS. Not arbitrary preference — this codebase already treats DK as the
 * house baseline for football (`season_dk_fppg_proxy` reads the provider's own
 * `DK_fantasy_points_per_game`). Using DK-shaped values for the other sports keeps one convention
 * across the engine instead of inventing a second, and DK's published scoring is a public,
 * checkable reference rather than a number somebody made up here.
 */

import type { SeasonAggregate } from './types'

/** Sports this module can score. Anything else must keep refusing rather than be defaulted. */
export type CategorySport = 'MLB' | 'NBA' | 'NHL' | 'NCAAB'

export function isCategoryScoredSport(sport: string | null | undefined): sport is CategorySport {
  const s = String(sport ?? '').trim().toUpperCase()
  return s === 'MLB' || s === 'NBA' || s === 'NHL' || s === 'NCAAB'
}

/**
 * ⚠ MLB KEYS COLLIDE ACROSS GROUPS AND MEAN OPPOSITE THINGS.
 *
 * `H`, `R`, `HR`, `BB`, `SB`, `CS`, `HBP`, `IBB`, `1B`, `2B`, `3B` all appear under BOTH
 * `regular_season.batting` and `regular_season.pitching`. A hit RECORDED and a hit ALLOWED are the
 * same key. Flattening the two groups into one namespace would add a pitcher's hits-allowed to a
 * batter's hits and score the result as offence — silently, with no error anywhere.
 *
 * So grouped components are addressed `"<group>.<KEY>"` and never merged. NBA and NHL are already
 * flat under `regular_season` and need no prefix.
 */
export const MLB_GROUPED_KEY_PREFIXES = ['batting', 'pitching'] as const

/**
 * DraftKings MLB, as published.
 *
 * Hitters score on the singles/doubles/triples split rather than total hits, which is why `1B`
 * matters and why a naive `H`-based rule would double-count.
 */
const MLB_RULES: Record<string, number> = {
  // --- hitting ---
  'batting.1B': 3,
  'batting.2B': 5,
  'batting.3B': 8,
  'batting.HR': 10,
  'batting.RBI': 2,
  'batting.R': 2,
  'batting.BB': 2,
  'batting.IBB': 2,
  'batting.HBP': 2,
  'batting.SB': 5,
  // --- pitching ---
  'pitching.IP': 2.25,
  'pitching.K': 2,
  'pitching.W': 4,
  'pitching.ER': -2,
  'pitching.H': -0.6,
  'pitching.BB': -0.6,
  'pitching.IBB': -0.6,
  'pitching.HBP': -0.6,
}

/**
 * DraftKings NBA, as published. `total_rebounds` is used rather than the offensive/defensive
 * split, because adding all three would count every rebound twice.
 */
const NBA_RULES: Record<string, number> = {
  points: 1,
  three_points_made: 0.5,
  total_rebounds: 1.25,
  assists: 1.5,
  steals: 2,
  blocks: 2,
  turnovers: -0.5,
}

/**
 * DraftKings NHL, as published — skaters and goalies in one map.
 *
 * The two never collide: the provider ships skater keys on skater rows (942 of 1,040 measured) and
 * goalie keys on goalie rows (98), so a player scores under whichever set they actually have.
 * `goals_allowed` is negative; a goalie's own `win` is worth more than a skater's assist.
 */
const NHL_RULES: Record<string, number> = {
  // --- skaters ---
  goals: 8.5,
  assists: 5,
  shots_on_goal: 1.5,
  blocks: 1.3,
  short_handed_goals: 2,
  short_handed_assists: 2,
  shootout_goals: 1.5,
  // --- goalies ---
  win: 6,
  saves: 0.7,
  goals_allowed: -3.5,
  shutouts: 4,
}

const RULES_BY_SPORT: Record<CategorySport, Record<string, number>> = {
  MLB: MLB_RULES,
  NBA: NBA_RULES,
  NHL: NHL_RULES,
  /*
   * College basketball scores the same categories as the NBA, on the SAME MEASURED VOCABULARY —
   * not an assumption from the sports being alike. Checked against production: `points`,
   * `total_rebounds`, `assists`, `steals`, `blocks`, `turnovers` and `three_points_made` are all
   * present on all 4,732 NCAAB stat lines, which is the same set NBA_RULES keys off.
   *
   * The provider agrees: `ROLLING_INSIGHTS_FIELD_MAPS.NCAABB.live` is literally
   * `{ ...NBA_LIVE_AND_BOX, ...NBA_LIVE_SHELL, starter }` — one vocabulary, one rule set.
   */
  NCAAB: NBA_RULES,
}

/**
 * Scoring rules for a sport, or null when the sport has none.
 *
 * Returning null rather than `{}` is deliberate: an empty rule set would score every player to
 * exactly 0.0 and present it as a projection, which is the fabrication this engine exists to
 * refuse. A caller that gets null must refuse.
 */
export function getCategoryScoringRules(sport: string | null | undefined): Record<string, number> | null {
  if (!isCategoryScoredSport(sport)) return null
  return RULES_BY_SPORT[String(sport).trim().toUpperCase() as CategorySport]
}

export interface CategoryScoringResult {
  /** Season total under the rules. Per-game division is the caller's job. */
  points: number
  /** Per-component contribution, so a number on screen can always be taken apart. */
  breakdown: Record<string, number>
  /** How many rule keys actually matched. Zero means refuse — see `scoreCategoryComponents`. */
  matched: number
}

/**
 * Score a flattened component map under a rule set.
 *
 * Returns null when NOTHING matched. That is the important case: a rule set whose keys do not
 * appear in the payload produces 0.0, and 0.0 rendered as a projection is indistinguishable from
 * a genuinely unproductive player. A stat-key rename upstream would otherwise turn the whole
 * sport into a wall of zeroes with no error raised anywhere.
 */
export function scoreCategoryComponents(args: {
  components: Record<string, number>
  rules: Record<string, number>
}): CategoryScoringResult | null {
  const breakdown: Record<string, number> = {}
  let points = 0
  let matched = 0

  for (const [key, weight] of Object.entries(args.rules)) {
    const amount = args.components[key]
    if (typeof amount !== 'number' || !Number.isFinite(amount)) continue
    matched += 1
    if (amount === 0) continue
    const contribution = amount * weight
    breakdown[key] = Math.round(contribution * 1000) / 1000
    points += contribution
  }

  if (matched === 0) return null
  return { points: Math.round(points * 1000) / 1000, breakdown, matched }
}

/**
 * The component map to score: flat components plus grouped ones addressed `"<group>.<KEY>"`.
 *
 * ⚠ `SeasonAggregate.components` DELIBERATELY DOES NOT CONTAIN THE GROUPED KEYS. `extractSeasonAggregate`
 * flattens one level and takes numbers only, so MLB's `batting` and `pitching` objects are dropped
 * there and NFL's `snap_counts` object is dropped too. Widening that extractor would have added
 * `snap_counts.*` to every NFL aggregate — a live path this change has no business touching. The
 * grouped keys therefore ride in a separate field and are merged only here, for the sports that
 * ask for them.
 */
export function componentsForCategoryScoring(aggregate: SeasonAggregate): Record<string, number> {
  return { ...aggregate.components, ...(aggregate.groupedComponents ?? {}) }
}
