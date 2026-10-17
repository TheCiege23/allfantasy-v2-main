/**
 * What a player is worth in a CATEGORY league, per game: his standing in each of the league's categories
 * against the rosterable player pool, summed. PURE.
 *
 * A category league is won category by category, so a points total answers a different question — a
 * high-volume 40%-shooting scorer helps PTS and hurts FG%, and a points grade sees only the first half.
 * This is the standard z-score method (Basketball Monster, Hashtag Basketball):
 *
 *   - COUNTING categories (PTS, REB, AST, STL, BLK, 3PM): the player's per-game average, as standard
 *     deviations above or below the pool average.
 *   - PERCENTAGE categories (FG%, FT%) are weighted by VOLUME, never read as a bare percentage: the
 *     category is decided by team totals, so a 90% shooter on one attempt a night barely moves it. Each
 *     player's impact is his makes above what the pool's average rate would make on his attempts
 *     (`made − poolRate × attempted`), and THAT is z-scored.
 *   - "Lower is better" categories (TO) count against the player.
 *   - TWO PASSES: the averages and spreads are taken over the players who would actually be rostered
 *     (pass 1 ranks everyone, pass 2 re-measures over that pool's top), or deep-bench noise sets the scale.
 *
 * ⚠ WHAT IT DOES NOT MODEL, stated in the grade's basis: punting (a team ignoring FT% values a poor
 * free-throw shooter more), week-to-week volatility (the G-score refinement), and games played beyond the
 * season count — the board is per game.
 */

import { categoryStatValue } from '@/lib/category-scoring/CategoryMatchupResolver'
import type { CategoryDefinition } from '@/lib/category-scoring/types'

export type CategoryPlayer = {
  id: string
  /** The player's projected per-game stat line, in the canonical short keys (`pts`, `reb`, `fgm`, …). */
  stats: Record<string, number>
  /** Only eligible players set the pool's averages; the rest are still valued against them. */
  eligible: boolean
}

export type CategoryValue = {
  /** Sum of the per-category scores, per game — the number a grade prices. */
  total: number
  /** Each category's score, keyed by category id. */
  byCategory: Record<string, number>
}

type Contribution = (stats: Record<string, number>) => number

/** A ratio category's numerator and denominator for one stat line (made and attempted). */
function ratioParts(stats: Record<string, number>, c: Extract<CategoryDefinition['computation'], { kind: 'ratio' }>): [number, number] {
  const extra = (c.additionalNumeratorStatKeys ?? []).reduce((s, k) => s + categoryStatValue(stats, k), 0)
  const num = (categoryStatValue(stats, c.numeratorStatKey) + extra) * (c.multiplier ?? 1)
  return [num, categoryStatValue(stats, c.denominatorStatKey)]
}

/** How one category is read off a stat line, given the pool it is measured against. */
function contributionFor(category: CategoryDefinition, pool: readonly CategoryPlayer[]): Contribution {
  const c = category.computation
  if (c.kind === 'sum') return (stats) => categoryStatValue(stats, c.statKey)
  // Volume-weighted: makes above what the pool's own rate would make on these attempts.
  let num = 0
  let den = 0
  for (const p of pool) {
    const [n, d] = ratioParts(p.stats, c)
    num += n
    den += d
  }
  const rate = den > 0 ? num / den : 0
  return (stats) => {
    const [n, d] = ratioParts(stats, c)
    return n - rate * d
  }
}

function meanAndSpread(xs: readonly number[]): { mean: number; sd: number } {
  if (xs.length === 0) return { mean: 0, sd: 0 }
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length
  return { mean, sd: Math.sqrt(variance) }
}

function scoreAgainst(
  players: readonly CategoryPlayer[],
  categories: readonly CategoryDefinition[],
  pool: readonly CategoryPlayer[],
): Map<string, CategoryValue> {
  const scorers = categories.map((category) => {
    const contribution = contributionFor(category, pool)
    const { mean, sd } = meanAndSpread(pool.map((p) => contribution(p.stats)))
    const sign = category.direction === 'lower' ? -1 : 1
    // A category with no spread in the pool separates nobody: it scores 0 for everyone.
    return { id: category.id, score: (stats: Record<string, number>) => (sd > 0 ? (sign * (contribution(stats) - mean)) / sd : 0) }
  })
  const out = new Map<string, CategoryValue>()
  for (const p of players) {
    const byCategory: Record<string, number> = {}
    let total = 0
    for (const s of scorers) {
      const z = s.score(p.stats)
      byCategory[s.id] = z
      total += z
    }
    out.set(p.id, { total, byCategory })
  }
  return out
}

/**
 * Per-game category value for every player. `poolSize` is how many players the league rosters (teams ×
 * roster spots): pass 1 measures against every eligible player, pass 2 against the best `poolSize` of them.
 */
export function categoryPerGameValues(
  players: readonly CategoryPlayer[],
  categories: readonly CategoryDefinition[],
  poolSize: number,
): Map<string, CategoryValue> {
  const eligible = players.filter((p) => p.eligible)
  if (eligible.length === 0 || categories.length === 0) return new Map()
  const first = scoreAgainst(eligible, categories, eligible)
  const size = Math.max(1, Math.min(eligible.length, Math.round(poolSize)))
  const pool = eligible
    .slice()
    .sort((a, b) => (first.get(b.id)?.total ?? 0) - (first.get(a.id)?.total ?? 0))
    .slice(0, size)
  return scoreAgainst(players, categories, pool)
}

/**
 * Category value when a sport's categories split between two kinds of player — baseball's hitters and
 * pitchers. Each group is valued only on its own categories and only against its own pool, then a
 * player's groups are summed (a two-way player is in both). Pooled together, a pitcher's zero home runs
 * would sink the hitting average and flatter every hitter, and the reverse for strikeouts.
 */
export function groupedCategoryValues(
  groups: ReadonlyArray<{ players: readonly CategoryPlayer[]; categories: readonly CategoryDefinition[]; poolSize: number }>,
): Map<string, CategoryValue> {
  const out = new Map<string, CategoryValue>()
  for (const g of groups) {
    for (const [id, v] of categoryPerGameValues(g.players, g.categories, g.poolSize)) {
      const held = out.get(id)
      out.set(id, held ? { total: held.total + v.total, byCategory: { ...held.byCategory, ...v.byCategory } } : v)
    }
  }
  return out
}

/** "PTS, REB, AST, STL, BLK, 3PM, FG%, FT% and TO" — the categories a grade was valued on. */
export function categoryList(categories: readonly Pick<CategoryDefinition, 'label'>[]): string {
  const labels = categories.map((c) => c.label)
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
}
