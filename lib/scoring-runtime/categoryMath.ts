import type { ScoringCategory } from '@/lib/sportConfig/types'

/** Authoritative pure category math, shared by live scoring and recorded replays. */
function bonusBaseYardsKey(catKey: string): string | null {
  if (catKey.includes('pass_') && catKey.includes('bonus')) return 'pass_yds'
  if (catKey.includes('rush_') && catKey.includes('bonus')) return 'rush_yds'
  if (catKey.includes('rec_') && catKey.includes('bonus')) return 'rec_yds'
  return null
}

export function pointsForCategory(cat: ScoringCategory, rawStats: Record<string, number>): number {
  const pts = cat.defaultPoints
  if (cat.minForBonus != null) {
    const base = bonusBaseYardsKey(cat.key)
    if (!base) return 0
    const yards = rawStats[base] ?? 0
    return yards >= cat.minForBonus ? pts : 0
  }
  // Threshold-tier categories (team-defense points/yards allowed): award the
  // tier's points when the single tier stat falls within [tierMin, tierMax].
  // The stat must be present — a real 0 (shutout) is a valid tier value, so
  // distinguish "absent" from "0" via a key check rather than `?? 0`.
  if (cat.tierStatKey != null) {
    if (!(cat.tierStatKey in rawStats)) return 0
    const value = rawStats[cat.tierStatKey]
    if (!Number.isFinite(value)) return 0
    const min = cat.tierMin ?? Number.NEGATIVE_INFINITY
    const max = cat.tierMax ?? Number.POSITIVE_INFINITY
    return value >= min && value <= max ? pts : 0
  }
  // Explicit role counts supersede the legacy aggregate conversion count.
  if (cat.sport === 'NCAAF' && cat.key === 'two_pt' && ['pass_2pt', 'rush_2pt', 'rec_2pt'].some(k => k in rawStats)) return 0
  const raw = rawStats[cat.key] ?? 0
  if (cat.unit === 'per_yard' || cat.unit === 'per_inning') {
    return raw * pts
  }
  return raw * pts
}

export function scoreStatsWithCategories(
  categories: ScoringCategory[],
  rawStats: Record<string, number>,
  overrides: Record<string, number> = {},
): number {
  let sum = 0
  for (const cat of categories) {
    const mult = overrides[cat.key] ?? cat.defaultPoints
    sum += pointsForCategory({ ...cat, defaultPoints: mult }, rawStats)
  }
  return sum
}
