/**
 * Late-season Survivor settings (finale, merge naming, Exile boss). Read from `League.settings`
 * JSON (top level or the nested `survivorFoundationSettings` snapshot) — no column migration.
 *
 * - `finalistCount`: 2 | 3 finalists at Final Tribal Council. Falls back to the full-season plan,
 *   then the legacy `League.survivorFinal3` column (false → 2), then 3.
 * - `mergeNamingMode`: 'commissioner' picks the merged tribe's name, 'manager_vote' lets the
 *   remaining managers vote on three suggested names.
 * - `exileBossMode`: how the weekly Exile boss score is set. 'median' = median of all active
 *   managers' week scores, 'fixed' = commissioner number, 'topN' = mean of the top N active scores,
 *   'chimmy_roster' = legacy Chimmy locked NBA roster (lib/survivor/exileChimmyBoss).
 *
 *   DEFAULTS (owner decision on #2470): leagues that existed before the score boss KEEP the Chimmy
 *   roster boss; only NEW leagues default to 'median'.
 *   - New leagues get `exileBossMode: 'median'` written into League.settings at creation
 *     (NEW_LEAGUE_EXILE_BOSS_MODE, via buildSurvivorSettingsSnapshot / createCanonicalLeague).
 *   - Migration 20261018160000 backfills `exileBossMode: 'chimmy_roster'` into every existing
 *     Survivor league's settings that has no value.
 *   - A league with NO stored value at read time resolves to 'chimmy_roster' (LEGACY_EXILE_BOSS_MODE):
 *     no stored value means the league predates this setting, so the safe fallback is the behaviour
 *     it was created with. A median boss only ever comes from an explicit value.
 */

export type SurvivorFinalistCount = 2 | 3
export type SurvivorMergeNamingMode = 'commissioner' | 'manager_vote'
export type SurvivorExileBossMode = 'median' | 'fixed' | 'topN' | 'chimmy_roster'

export interface SurvivorLateSeasonSettings {
  finalistCount: SurvivorFinalistCount
  mergeNamingMode: SurvivorMergeNamingMode
  exileBossMode: SurvivorExileBossMode
  exileBossFixedScore: number | null
  exileBossTopN: number
}

/** Written into a new league's settings at creation. */
export const NEW_LEAGUE_EXILE_BOSS_MODE = 'median' as const
/** Read-time fallback when nothing is stored: the pre-existing (Chimmy roster) behaviour. */
export const LEGACY_EXILE_BOSS_MODE = 'chimmy_roster' as const

export const SURVIVOR_LATE_SEASON_DEFAULTS: SurvivorLateSeasonSettings = {
  finalistCount: 3,
  mergeNamingMode: 'commissioner',
  exileBossMode: LEGACY_EXILE_BOSS_MODE,
  exileBossFixedScore: null,
  exileBossTopN: 3,
}

type Rec = Record<string, unknown>

function rec(value: unknown): Rec {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : {}
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

export function readSurvivorLateSeasonSettings(
  settings: unknown,
  columns?: { survivorFinal3?: boolean | null },
): SurvivorLateSeasonSettings {
  const top = rec(settings)
  const s = { ...rec(top.survivorFoundationSettings), ...top }
  const plan = rec(top.survivor_full_season_plan)
  const base = SURVIVOR_LATE_SEASON_DEFAULTS

  // A saved full-season plan scheduled its eliminations for its finalist count, so it wins.
  const rawFinalists = num(plan.finalistCount) ?? num(s.finalistCount)
  const finalistCount: SurvivorFinalistCount =
    rawFinalists === 2 || rawFinalists === 3 ? rawFinalists : columns?.survivorFinal3 === false ? 2 : base.finalistCount

  const naming = typeof s.mergeNamingMode === 'string' ? s.mergeNamingMode.trim().toLowerCase() : ''
  const mergeNamingMode: SurvivorMergeNamingMode = naming === 'manager_vote' || naming === 'vote' ? 'manager_vote' : 'commissioner'

  const modeRaw = typeof s.exileBossMode === 'string' ? s.exileBossMode.trim() : ''
  const exileBossMode: SurvivorExileBossMode =
    modeRaw === 'median' || modeRaw === 'fixed' || modeRaw === 'topN' || modeRaw === 'chimmy_roster' ? modeRaw
      : modeRaw.toLowerCase() === 'topn' ? 'topN'
      : base.exileBossMode // nothing (or junk) stored: keep the league's original Chimmy boss

  const fixed = num(s.exileBossFixedScore)
  const topN = num(s.exileBossTopN)
  return {
    finalistCount,
    mergeNamingMode,
    // A fixed boss with no number cannot be computed; fall back to the median rather than 0.
    exileBossMode: exileBossMode === 'fixed' && (fixed == null || fixed < 0) ? 'median' : exileBossMode,
    exileBossFixedScore: fixed != null && fixed >= 0 ? Math.round(fixed * 100) / 100 : null,
    exileBossTopN: topN != null && topN >= 1 ? Math.min(20, Math.floor(topN)) : base.exileBossTopN,
  }
}

/**
 * The boss a league actually plays against. The Chimmy roster boss only exists for NBA (it locks an
 * NBA roster before tipoff), so an NFL or NHL league carrying the legacy value (a pre-score-boss
 * league, or one with nothing stored) plays the default score boss, the league median. Without
 * this, its Exile weeks waited for a Chimmy score that could never be produced and never settled.
 */
export function effectiveExileBossMode(mode: SurvivorExileBossMode, sport: string | null | undefined): SurvivorExileBossMode {
  return mode === 'chimmy_roster' && String(sport ?? '').toUpperCase() !== 'NBA' ? NEW_LEAGUE_EXILE_BOSS_MODE : mode
}

/** Stamp late-season defaults onto a NEW league's settings (never overwrites a stored value). */
export function withNewLeagueLateSeasonDefaults<T extends Record<string, unknown>>(settings: T): T & { exileBossMode: SurvivorExileBossMode } {
  const stored = typeof settings.exileBossMode === 'string' && settings.exileBossMode ? (settings.exileBossMode as SurvivorExileBossMode) : NEW_LEAGUE_EXILE_BOSS_MODE
  return { ...settings, exileBossMode: stored }
}

/** Validate a commissioner patch. Returns the keys to merge into League.settings, or an error. */
export function validateSurvivorLateSeasonPatch(input: unknown): { ok: true; patch: Rec } | { ok: false; error: string } {
  const body = rec(input)
  const patch: Rec = {}
  if ('finalistCount' in body) {
    if (body.finalistCount !== 2 && body.finalistCount !== 3) return { ok: false, error: 'finalistCount must be 2 or 3.' }
    patch.finalistCount = body.finalistCount
  }
  if ('mergeNamingMode' in body) {
    if (body.mergeNamingMode !== 'commissioner' && body.mergeNamingMode !== 'manager_vote') return { ok: false, error: 'mergeNamingMode must be commissioner or manager_vote.' }
    patch.mergeNamingMode = body.mergeNamingMode
  }
  if ('exileBossMode' in body) {
    if (!['median', 'fixed', 'topN', 'chimmy_roster'].includes(String(body.exileBossMode))) return { ok: false, error: 'exileBossMode must be median, fixed, topN or chimmy_roster.' }
    patch.exileBossMode = body.exileBossMode
  }
  if ('exileBossFixedScore' in body) {
    const fixed = num(body.exileBossFixedScore)
    if (fixed == null || fixed < 0 || fixed > 10000) return { ok: false, error: 'exileBossFixedScore must be a number from 0 to 10000.' }
    patch.exileBossFixedScore = Math.round(fixed * 100) / 100
  }
  if ('exileBossTopN' in body) {
    const n = num(body.exileBossTopN)
    if (n == null || !Number.isInteger(n) || n < 1 || n > 20) return { ok: false, error: 'exileBossTopN must be a whole number from 1 to 20.' }
    patch.exileBossTopN = n
  }
  if (patch.exileBossMode === 'fixed' && patch.exileBossFixedScore == null) return { ok: false, error: 'A fixed boss needs exileBossFixedScore.' }
  if (!Object.keys(patch).length) return { ok: false, error: 'No late-season settings in the request.' }
  return { ok: true, patch }
}

export function describeExileBossMode(settings: Pick<SurvivorLateSeasonSettings, 'exileBossMode' | 'exileBossTopN' | 'exileBossFixedScore'>): string {
  switch (settings.exileBossMode) {
    case 'fixed':
      return `fixed at ${settings.exileBossFixedScore ?? 0}`
    case 'topN':
      return `average of the top ${settings.exileBossTopN}`
    case 'chimmy_roster':
      return "Chimmy's locked roster"
    default:
      return 'league median'
  }
}
