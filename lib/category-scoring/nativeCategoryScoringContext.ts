import { getCategoryPresetDefinitions } from './index'

/** Facts from validated stored rules only; never infer category mode from a label. */
export function nativeCategoryScoringContext(settings: unknown, sport: string) {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings as Record<string, unknown> : {}
  const mode = s.scoring_mode
  const presetId = s.category_preset_id
  const recordMode = s.category_record_mode
  const upper = sport.toUpperCase()
  const supported = upper === 'NBA' ? ['nba_8cat', 'nba_8cat_standard', 'nba_9cat'] : upper === 'MLB' ? ['mlb_5x5', 'mlb_6x6'] : upper === 'NHL' ? ['nhl_10cat'] : []
  if (typeof presetId !== 'string' || !supported.includes(presetId) || !['h2h_category', 'roto'].includes(String(mode))) return null
  // NBA rotisserie is offered on the 9-cat set only; NHL categories are offered head-to-head only.
  if (upper === 'NBA' && mode === 'roto' && presetId !== 'nba_9cat') return null
  if (upper === 'NHL' && mode !== 'h2h_category') return null
  if (mode === 'roto' ? recordMode !== 'roto' : recordMode !== 'each' && recordMode !== 'most') return null
  const categories = getCategoryPresetDefinitions(presetId)
  if (!categories) return null
  const sportConfig = s.sportConfig as Record<string, unknown> | undefined
  return { mode, presetId, recordMode, lineupLockType: sportConfig?.lineupLockType === 'first_game_of_week' ? 'first_game_of_week' : null,
    categories: categories.map(({id, label, direction, computation}) => ({id, label, direction, computation})) }
}
export type NativeCategoryScoringContext = ReturnType<typeof nativeCategoryScoringContext>

/**
 * A rotisserie league, from its stored rules alone. Roto has no weekly opponent: its matchup rows are
 * only scoring containers (scores pinned to 0), and standings are season-long category ranks.
 */
export function isRotisserieLeagueSettings(settings: unknown): boolean {
  return Boolean(settings && typeof settings === 'object' && !Array.isArray(settings) && (settings as Record<string, unknown>).scoring_mode === 'roto')
}
