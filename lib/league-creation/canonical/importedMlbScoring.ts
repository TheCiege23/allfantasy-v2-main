import { MLB_CONFIG } from '@/lib/sportConfig/configs/mlb'
import { UI_SCORING_STORES } from '@/lib/redraft/uiScoringStoreBridge'
import { buildFullMlbScoringConfig } from '@/lib/mlb-scoring/MlbScoringPresets'
import { getDefaultScoringTemplate } from '@/lib/scoring-defaults/ScoringDefaultsRegistry'
import { templateStatKeyFromUiKey } from '@/lib/league/scoring-stat-metadata'

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** An import is a complete rule set: unspecified categories must score zero. */
export function importedMlbScoring(settings: unknown) {
  const source = record(settings)
  const scoring = record(source.scoringSettings)
  const rules = record(scoring.rules)
  const gaps = record(source.fantrax_settings).scoringGaps
  if (Array.isArray(gaps) && gaps.length) throw new Error(`Review the imported scoring rules before making this league native: ${gaps.join('; ')}`)
  if (!Object.keys(rules).length) throw new Error('The import has no verified baseball points rules. Refresh the import before making it native.')
  if (/categor|roti/i.test(String(scoring.format ?? ''))) throw new Error('This baseball category format needs native scoring support before it can be activated. Its imported history remains available.')
  const categoryPoints = Object.fromEntries(MLB_CONFIG.scoringCategories.map(c => [c.key, 0]))
  for (const [key, value] of Object.entries(rules)) {
    if (!(key in categoryPoints) || typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Imported baseball scoring rule ${key} cannot be scored exactly. Review the source settings before making it native.`)
    }
    categoryPoints[key] = value
  }
  const uiRules = { ...Object.fromEntries(Object.keys(buildFullMlbScoringConfig('af_default')).map(key => [key, 0])), ...Object.fromEntries(Object.entries(UI_SCORING_STORES.MLB!.keyMap).map(([uiKey, engineKey]) => [uiKey, categoryPoints[engineKey] ?? 0])) }
  const templatePoints = Object.fromEntries(getDefaultScoringTemplate('MLB', 'standard').rules.map(rule => [rule.statKey, 0]))
  for (const [uiKey, value] of Object.entries(uiRules)) templatePoints[templateStatKeyFromUiKey('MLB', uiKey)] = value
  templatePoints.strikeouts_pitched = categoryPoints.so ?? 0
  return { categoryPoints, uiRules, templatePoints, scoringSettings: scoring }
}
