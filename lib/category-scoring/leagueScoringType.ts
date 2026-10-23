/**
 * A league's scoring TYPE (points / H2H categories / roto) and its category list, and how a change
 * to either after creation is validated, stored and read back per week.
 *
 * Stored on `League.settings` (no schema change):
 *   - `scoring_mode`, `category_preset_id`, `category_record_mode` — as at creation.
 *   - `category_ids` — NEW, optional. An ordered custom category list for a category league. Absent
 *     or null means "the preset's own list", so every existing league reads exactly as before.
 *   - `scoring_type_history` — NEW, optional. One entry per mid-season switch:
 *     `{ season, effectiveFromWeek, previous, changedAt, changedBy }`.
 *
 * 🛑 THE DATA RULE FOR A SWITCH. A switch takes effect from the first week of the season that has NO
 * final result yet (`effectiveFromWeek`). Every earlier week keeps scoring under the type it was
 * played under — including when a stat correction re-runs it — because the scoring engines read the
 * settings through `settingsForScoringWeek`, which swaps in the `previous` snapshot for those weeks.
 * Standings are rebuilt from the stored per-matchup results, so they pick up the new type from the
 * switch onward and nothing before it moves. A week that already has one final matchup stays
 * entirely on the old type (week granularity, so one week never mixes two types).
 *
 * Adding a sport or a type (NHL categories, NBA roto…): add its presets/catalog/modes to
 * `SPORT_SCORING_TYPES` and its preset ids to `getCategoryPresetDefinitions`. The validation, the
 * editor, the history and the per-week resolution here are generic over that table.
 */

import type { CategoryDefinition, ScoringMode } from './types'
import { MLB_FIVE_BY_FIVE, MLB_SIX_BY_SIX } from './MlbCategoryRegistry'
import { NBA_EIGHT_CAT, NBA_LEGACY_EIGHT_CAT, NBA_NINE_CAT } from './NbaCategoryRegistry'
import { NHL_STANDARD_CATEGORIES } from './NhlCategoryRegistry'

export type CategoryRecordMode = 'each' | 'most' | 'roto'

export type SportScoringTypes = {
  /** Scoring types this sport's engine can score. `points` is always first. */
  modes: readonly ScoringMode[]
  /** Category presets, keyed by the persisted `category_preset_id`. */
  presets: Readonly<Record<string, readonly CategoryDefinition[]>>
  /** Every category a custom list may use, in display order. */
  catalog: readonly CategoryDefinition[]
  /** When set, the only presets rotisserie may use (NBA roto is the 9-cat set only). */
  rotoPresets?: readonly string[]
}

const POINTS_ONLY: SportScoringTypes = { modes: ['points'], presets: {}, catalog: [] }

/**
 * Mirrors what the engines and `nativeCategoryScoringContext` accept today: NBA H2H categories and
 * 9-cat roto, MLB and NHL H2H categories and roto. Every other sport is points only on this base.
 */
export const SPORT_SCORING_TYPES: Readonly<Record<string, SportScoringTypes>> = {
  NBA: {
    modes: ['points', 'h2h_category', 'roto'],
    presets: { nba_8cat: NBA_LEGACY_EIGHT_CAT, nba_8cat_standard: NBA_EIGHT_CAT, nba_9cat: NBA_NINE_CAT },
    catalog: NBA_NINE_CAT,
    rotoPresets: ['nba_9cat'],
  },
  MLB: {
    modes: ['points', 'h2h_category', 'roto'],
    presets: { mlb_5x5: MLB_FIVE_BY_FIVE, mlb_6x6: MLB_SIX_BY_SIX },
    catalog: MLB_SIX_BY_SIX,
  },
  NHL: {
    modes: ['points', 'h2h_category', 'roto'],
    presets: { nhl_standard: NHL_STANDARD_CATEGORIES },
    catalog: NHL_STANDARD_CATEGORIES,
  },
}

export function scoringTypesForSport(sport: string | null | undefined): SportScoringTypes {
  return SPORT_SCORING_TYPES[String(sport ?? '').toUpperCase()] ?? POINTS_ONLY
}

const CATEGORY_BY_ID: ReadonlyMap<string, CategoryDefinition> = new Map(
  Object.values(SPORT_SCORING_TYPES).flatMap((s) => [
    ...s.catalog.map((c) => [c.id, c] as const),
    ...Object.values(s.presets).flatMap((list) => list.map((c) => [c.id, c] as const)),
  ]),
)

function presetDefinitions(presetId: unknown): readonly CategoryDefinition[] | null {
  if (typeof presetId !== 'string') return null
  for (const s of Object.values(SPORT_SCORING_TYPES)) if (s.presets[presetId]) return s.presets[presetId]
  return null
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** A stored custom list, only when every id is known and none repeats; otherwise null. */
function storedCategoryIds(settings: unknown): string[] | null {
  const raw = asRecord(settings).category_ids
  if (!Array.isArray(raw) || raw.length === 0) return null
  if (!raw.every((id) => typeof id === 'string' && CATEGORY_BY_ID.has(id))) return null
  if (new Set(raw).size !== raw.length) return null
  return raw as string[]
}

/**
 * The category list a league scores. A valid stored `category_ids` wins; otherwise the preset's
 * list — `presetId` is passed by the caller so each engine keeps reading the preset key it always
 * read. With no `category_ids` this is exactly `getCategoryPresetDefinitions(presetId)`.
 */
export function resolveLeagueCategories(settings: unknown, presetId: unknown): readonly CategoryDefinition[] | null {
  const ids = storedCategoryIds(settings)
  if (ids) return ids.map((id) => CATEGORY_BY_ID.get(id)!)
  return presetDefinitions(presetId)
}

export type ScoringTypeSnapshot = {
  mode: string
  presetId: string | null
  recordMode: string | null
  /** null = the preset's own list. */
  categoryIds: string[] | null
}

/** The scoring type stored on `settings` now (flat keys, then the nested legacy copy). */
export function readScoringType(settings: unknown): ScoringTypeSnapshot {
  const s = asRecord(settings)
  const nested = asRecord(s.scoringSettings)
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null)
  return {
    mode: str(s.scoring_mode) ?? str(nested.scoringMode) ?? 'points',
    presetId: str(s.category_preset_id) ?? str(nested.categoryPresetId),
    recordMode: str(s.category_record_mode) ?? str(nested.categoryRecordMode),
    categoryIds: storedCategoryIds(s),
  }
}

export type ScoringTypeHistoryEntry = {
  season: number
  effectiveFromWeek: number
  previous: ScoringTypeSnapshot
  changedAt: string
  changedBy: string
}

function readHistory(settings: unknown): ScoringTypeHistoryEntry[] {
  const raw = asRecord(settings).scoring_type_history
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (e): e is ScoringTypeHistoryEntry =>
      Boolean(e) &&
      typeof e === 'object' &&
      Number.isFinite((e as ScoringTypeHistoryEntry).season) &&
      Number.isFinite((e as ScoringTypeHistoryEntry).effectiveFromWeek) &&
      Boolean((e as ScoringTypeHistoryEntry).previous) &&
      typeof (e as ScoringTypeHistoryEntry).previous === 'object',
  )
}

/**
 * `settings` as the scoring engines must see them for one season-week. When no switch in that
 * season took effect after `week`, the SAME object is returned, so a league that never switched
 * scores byte-for-byte as before. Otherwise the type keys are replaced by the snapshot that was in
 * force for that week: the oldest switch whose `effectiveFromWeek` is after it.
 */
export function settingsForScoringWeek<T>(settings: T, season: number | null | undefined, week: number): T {
  if (season == null || !Number.isFinite(week)) return settings
  const applicable = readHistory(settings)
    .filter((e) => e.season === season && week < e.effectiveFromWeek)
    .sort((a, b) => a.effectiveFromWeek - b.effectiveFromWeek || a.changedAt.localeCompare(b.changedAt))
  const snapshot = applicable[0]?.previous
  if (!snapshot) return settings
  return {
    ...asRecord(settings),
    scoring_mode: snapshot.mode,
    category_preset_id: snapshot.presetId,
    category_record_mode: snapshot.recordMode,
    category_ids: snapshot.categoryIds,
  } as T
}

export type ScoringTypeInput = {
  mode?: unknown
  presetId?: unknown
  categoryIds?: unknown
  recordMode?: unknown
}

export type ScoringTypeValidation =
  | { ok: true; next: ScoringTypeSnapshot }
  | { ok: false; code: string; error: string }

const fail = (code: string, error: string): ScoringTypeValidation => ({ ok: false, code, error })

/**
 * Validate a requested scoring type for a sport. Omitted fields keep the league's current value when
 * it is still valid for the new type, else the type's default. A category list must be a non-empty
 * array of this sport's category ids with no repeats.
 */
export function validateScoringTypeChange(
  sport: string | null | undefined,
  input: ScoringTypeInput,
  current: ScoringTypeSnapshot,
): ScoringTypeValidation {
  const types = scoringTypesForSport(sport)
  const mode = input.mode === undefined ? current.mode : input.mode
  if (typeof mode !== 'string' || !(types.modes as readonly string[]).includes(mode)) {
    return fail('unsupported_scoring_mode', `This sport does not support the "${String(mode)}" scoring type.`)
  }
  if (mode === 'points') return { ok: true, next: { mode, presetId: null, recordMode: null, categoryIds: null } }

  const presetIds = mode === 'roto' && types.rotoPresets ? [...types.rotoPresets] : Object.keys(types.presets)
  const presetRaw =
    input.presetId !== undefined ? input.presetId : current.presetId && presetIds.includes(current.presetId) ? current.presetId : presetIds[0]
  if (typeof presetRaw !== 'string' || !presetIds.includes(presetRaw)) {
    return fail(
      'unsupported_category_preset',
      mode === 'roto' && typeof presetRaw === 'string' && presetRaw in types.presets
        ? `Rotisserie uses the ${presetIds.join(' / ')} categories in this sport, not "${presetRaw}".`
        : `Unknown category preset "${String(presetRaw)}" for this sport.`,
    )
  }

  let categoryIds: string[] | null = null
  const requested = input.categoryIds
  if (requested !== undefined && requested !== null) {
    if (!Array.isArray(requested) || requested.length === 0) {
      return fail('invalid_category_list', 'Pick at least one category.')
    }
    const allowed = new Set(types.catalog.map((c) => c.id))
    const seen = new Set<string>()
    for (const id of requested as unknown[]) {
      if (typeof id !== 'string' || !allowed.has(id)) {
        return fail('unknown_category', `"${String(id)}" is not a supported category for this sport.`)
      }
      if (seen.has(id)) return fail('duplicate_category', `"${id}" is listed more than once.`)
      seen.add(id)
    }
    const list = requested as string[]
    const presetList = types.presets[presetRaw].map((c) => c.id)
    // The preset's own list in its own order is stored as "preset" so defaults stay defaults.
    categoryIds = presetList.length === list.length && presetList.every((id, i) => id === list[i]) ? null : [...list]
  } else if (input.categoryIds === undefined && current.mode === mode && current.presetId === presetRaw) {
    categoryIds = current.categoryIds
  }

  const recordModes: readonly string[] = mode === 'roto' ? ['roto'] : ['each', 'most']
  const recordRaw =
    input.recordMode !== undefined
      ? input.recordMode
      : current.recordMode && recordModes.includes(current.recordMode)
        ? current.recordMode
        : recordModes[recordModes.length - 1]
  if (typeof recordRaw !== 'string' || !recordModes.includes(recordRaw)) {
    return fail('unsupported_record_mode', `"${String(recordRaw)}" is not a valid record mode for ${mode}.`)
  }
  return { ok: true, next: { mode, presetId: presetRaw, recordMode: recordRaw, categoryIds } }
}

export function sameScoringType(a: ScoringTypeSnapshot, b: ScoringTypeSnapshot): boolean {
  return (
    a.mode === b.mode &&
    (a.presetId ?? null) === (b.presetId ?? null) &&
    (a.recordMode ?? null) === (b.recordMode ?? null) &&
    JSON.stringify(a.categoryIds ?? null) === JSON.stringify(b.categoryIds ?? null)
  )
}

/**
 * The new `settings` object for a switch. `history` is set only when the season already has a final
 * result; with nothing final the new type simply applies to every week.
 */
export function applyScoringTypeChange(
  settings: unknown,
  next: ScoringTypeSnapshot,
  history: { season: number; effectiveFromWeek: number; changedAt: string; changedBy: string } | null,
): Record<string, unknown> {
  const s = { ...asRecord(settings) }
  const previous = readScoringType(s)
  s.scoring_mode = next.mode
  s.category_preset_id = next.presetId
  s.category_record_mode = next.recordMode
  s.category_ids = next.categoryIds
  if (history) {
    const entry: ScoringTypeHistoryEntry = { ...history, previous }
    s.scoring_type_history = [...readHistory(settings), entry]
  }
  return s
}
