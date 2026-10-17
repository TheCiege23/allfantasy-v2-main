import { getCategoryPresetDefinitions } from './index'

/** Only stored, supported native settings become facts for OS and Chimmy consumers. */
export function nativeMlbScoringContext(settings: unknown) {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings as Record<string, unknown> : {}
  const mode = s.scoring_mode
  const presetId = s.category_preset_id
  const recordMode = s.category_record_mode
  if ((mode !== 'h2h_category' && mode !== 'roto') || (presetId !== 'mlb_5x5' && presetId !== 'mlb_6x6')) return null
  if (mode === 'roto' ? recordMode !== 'roto' : recordMode !== 'each' && recordMode !== 'most') return null
  const categories = getCategoryPresetDefinitions(presetId)
  if (!categories) return null
  const sportConfig = s.sportConfig as Record<string, unknown> | undefined
  return { mode, presetId, recordMode, lineupLockType: sportConfig?.lineupLockType === 'first_game_of_week' ? 'first_game_of_week' : null,
    categories: categories.map(({id, label, direction, computation}) => ({id, label, direction, computation})) }
}
export type NativeMlbScoringContext = ReturnType<typeof nativeMlbScoringContext>
