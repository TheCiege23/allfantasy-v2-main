import type { ScoringCategory } from '@/lib/sportConfig/types'

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

/** Fantrax uses the importer stat namespace, not the commissioner-panel namespace. */
const KEYS: Readonly<Record<string, string>> = {
  pass_yd: 'pass_yds', pass_td: 'pass_td', pass_int: 'pass_int',
  rush_yd: 'rush_yds', rush_td: 'rush_td', rec: 'rec', rec_yd: 'rec_yds', rec_td: 'rec_td',
  fum_lost: 'fum_lost', fum_rec_td: 'fumble_td', kr_td: 'kr_td', pr_td: 'pr_td',
  bonus_rec_te: 'te_premium',
  // The current canonical provider stat is an aggregate conversion count. Athlete evidence
  // remains a separate coverage requirement; do not derive a count from a team point total.
  rush_2pt: 'two_pt', rec_2pt: 'two_pt',
}

/**
 * A points-based imported rule list is an authoritative schedule: absent categories score zero,
 * not the application's default weights. Native and other-provider leagues are untouched.
 * Preserve separate return categories and the additive (not total) TE reception premium.
 */
export function importedNcaafScoring(
  sport: string, settings: unknown, allCategories: readonly ScoringCategory[],
): { categories: ScoringCategory[]; overrides: Record<string, number> } | null {
  if (sport !== 'NCAAF') return null
  const scoring = record(record(settings)?.scoringSettings)
  const rules = record(scoring?.rules)
  if (scoring?.source !== 'fantrax' || !rules || !Object.keys(rules).length) return null
  const mapped: Record<string, number> = {}
  for (const [key, value] of Object.entries(rules)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid imported Fantrax scoring weight')
    const target = KEYS[key]
    if (!target) continue // Import coverage already records unsupported source categories.
    if (mapped[target] !== undefined && mapped[target] !== value) {
      throw new Error('Conflicting imported Fantrax scoring weights')
    }
    mapped[target] = value
  }
  if (!Object.keys(mapped).length) throw new Error('No supported imported Fantrax scoring weights')
  const categories = allCategories.filter(c => !c.requiresToggle || c.key in mapped)
  const overrides = Object.fromEntries(categories.map(c => [c.key, 0]))
  return { categories, overrides: { ...overrides, ...mapped } }
}

/** Display the same source weights in the existing commissioner panel, with absent rows at zero.
 * Passing conversions are deliberately not inferred from Fantrax's rushing/receiving category.
 */
export function importedNcaafPanelRules(settings: unknown, panelKeys: readonly string[]): Record<string, number> | null {
  const scoring = record(record(settings)?.scoringSettings)
  const rules = record(scoring?.rules)
  if (scoring?.source !== 'fantrax' || !rules || !Object.keys(rules).length) return null
  const out = Object.fromEntries(panelKeys.map(key => [key, 0]))
  const map: Record<string, string> = {
    pass_yd: 'passing_yards', pass_td: 'passing_td', pass_int: 'interception_thrown',
    rush_yd: 'rushing_yards', rush_td: 'rushing_td', rec: 'reception', rec_yd: 'receiving_yards',
    rec_td: 'receiving_td', fum_lost: 'fumble_lost', fum_rec_td: 'off_fumble_recovery_td',
    bonus_rec_te: 'te_premium', rush_2pt: 'rushing_2pt', rec_2pt: 'receiving_2pt',
  }
  for (const [key, value] of Object.entries(rules)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid imported Fantrax scoring weight')
    if (map[key]) out[map[key]!] = value
  }
  if (rules.kr_td !== rules.pr_td) throw new Error('Distinct Fantrax return weights cannot use the combined panel row')
  out.return_td = typeof rules.kr_td === 'number' ? rules.kr_td : 0
  return out
}
