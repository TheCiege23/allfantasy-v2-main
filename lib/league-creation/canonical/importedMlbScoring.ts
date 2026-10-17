import { ESPN_MLB_CATEGORY_KEYS } from '@/lib/league-import/espn/EspnMlbScoring'
import { MLB_FIVE_BY_FIVE, MLB_SIX_BY_SIX } from '@/lib/category-scoring'
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
  const espn = record(source.espn_settings)
  const espnScoring = record(espn.scoringSettings)
  const espnRoster = record(espn.rosterSettings)
  if (Object.keys(record(espnRoster.lineupSlotStatLimits)).length || Object.keys(record(espnScoring.statQualificationMinimum)).length) {
    throw new Error('Imported baseball pitching qualifications or stat limits require native support before conversion.')
  }
  const categoryFormat = /categor|roti/i.test(String(scoring.format ?? espnScoring.scoringType ?? ''))
  let categoryPresetId: string | undefined
  let categoryRecordMode: 'each' | 'most' | 'roto' | undefined
  if (categoryFormat) {
    const items = Array.isArray(espnScoring.scoringItems) ? espnScoring.scoringItems : []
    const ids = items.map(item => ESPN_MLB_CATEGORY_KEYS[Number(record(item).statId)])
    const same = (cats: readonly {id:string}[]) => ids.length === cats.length && new Set(ids).size === cats.length && cats.every(c=>ids.includes(c.id))
    categoryPresetId = same(MLB_FIVE_BY_FIVE) ? 'mlb_5x5' : same(MLB_SIX_BY_SIX) ? 'mlb_6x6' : undefined
    if (!categoryPresetId || !/^(?:H2H_(?:MOST_)?CATEGORIES|ROTO)$/i.test(String(espnScoring.scoringType)))
      throw new Error('This baseball category format needs native scoring support before it can be activated. Its imported history remains available.')
    for (const item of items) {
      const rule=record(item); const id=ESPN_MLB_CATEGORY_KEYS[Number(rule.statId)]
      const reversed=['era','whip'].includes(id)
      if (Boolean(rule.isReverseItem) !== reversed || (typeof rule.points === 'number' && rule.points !== 1))
        throw new Error('Imported category direction or weighting cannot be reproduced exactly.')
    }
    if (espnScoring.matchupTieRule && espnScoring.matchupTieRule !== 'NONE')
      throw new Error('Imported category matchup tiebreaker requires review before native conversion.')
    categoryRecordMode = espnScoring.scoringType === 'ROTO' ? 'roto' : espnScoring.scoringType === 'H2H_MOST_CATEGORIES' ? 'most' : 'each'
  }
  const gaps = record(source.fantrax_settings).scoringGaps
  if (Array.isArray(gaps) && gaps.length) throw new Error(`Review the imported scoring rules before making this league native: ${gaps.join('; ')}`)
  if (!categoryFormat && !Object.keys(rules).length) throw new Error('The import has no verified baseball points rules. Refresh the import before making it native.')
  const categoryPoints = Object.fromEntries(MLB_CONFIG.scoringCategories.map(c => [c.key, 0]))
  for (const [key, value] of Object.entries(categoryFormat ? {} : rules)) {
    if (!(key in categoryPoints) || typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Imported baseball scoring rule ${key} cannot be scored exactly. Review the source settings before making it native.`)
    }
    categoryPoints[key] = value
  }
  const uiRules = { ...Object.fromEntries(Object.keys(buildFullMlbScoringConfig('af_default')).map(key => [key, 0])), ...Object.fromEntries(Object.entries(UI_SCORING_STORES.MLB!.keyMap).map(([uiKey, engineKey]) => [uiKey, categoryPoints[engineKey] ?? 0])) }
  const templatePoints = Object.fromEntries(getDefaultScoringTemplate('MLB', 'standard').rules.map(rule => [rule.statKey, 0]))
  for (const [uiKey, value] of Object.entries(uiRules)) templatePoints[templateStatKeyFromUiKey('MLB', uiKey)] = value
  templatePoints.strikeouts_pitched = categoryPoints.so ?? 0
  const scoringMode = categoryRecordMode === 'roto' ? 'roto' : categoryFormat ? 'h2h_category' : 'points'
  return { categoryPoints, uiRules, templatePoints, scoringMode, categoryPresetId, categoryRecordMode, scoringSettings: { ...scoring, scoringMode, ...(categoryPresetId ? { categoryPresetId, categoryRecordMode } : {}) } }
}
