import { getCategoryPresetDefinitions } from './index'
import type { CategoryDefinition, ScoringMode } from './types'

export function categorySettingsForPreset(preset: string, sport: string): Record<string, unknown> {
  const presetId = preset.replace(/_roto$/, '')
  if (!getCategoryPresetDefinitions(presetId)) return {}
  if (!presetId.startsWith(`${sport.toLowerCase()}_`)) throw new Error('INVALID_CATEGORY_PRESET_SPORT')
  return { scoringMode: preset.endsWith('_roto') ? 'roto' : 'h2h_category', categoryPresetId: presetId }
}

/** Accept the canonical snapshot and the two older stores, in explicit order. */
export function resolveLeagueScoringMode(settings: unknown, sport: string): {
  mode: ScoringMode; categories: readonly CategoryDefinition[]; presetId: string | null
} {
  const s = (settings ?? {}) as Record<string, any>
  const sc = s.scoringSettings ?? s.foundation_defaults?.scoring ?? {}
  const raw = s.scoring_mode ?? sc.scoringMode ?? s.sportConfig?.scoringMode ?? 'points'
  const mode = raw === 'categories' ? 'h2h_category' : raw
  if (!['points', 'h2h_category', 'roto'].includes(mode)) throw new Error('INVALID_SCORING_MODE')
  if (mode === 'points') return { mode, categories: [], presetId: null }
  const presetId = s.category_preset_id ?? sc.categoryPresetId ?? s.sportConfig?.categoryPresetId
  const categories = getCategoryPresetDefinitions(presetId)
  if (!categories || !String(presetId).startsWith(`${sport.toLowerCase()}_`)) throw new Error('INVALID_CATEGORY_PRESET')
  const minima = s.category_minimum_denominators ?? {}
  return { mode, presetId, categories: categories.map(c => c.computation.kind === 'ratio' &&
    typeof minima[c.id] === 'number' && Number.isFinite(minima[c.id]) && minima[c.id] > 0
    ? { ...c, computation: { ...c.computation, minimumDenominator: minima[c.id] } } : c) }
}
