/**
 * NFL rookie classification policy — Sleeper years_exp fallback when RI doc omits rookie fields.
 */

/** Structural subset of pool rows — avoids importing draftPlayerRookie (cycle). */
export type NflRookiePolicyPlayerLike = {
  isRookie?: boolean
  rookie?: boolean
  yearsExp?: number | null
  experience?: number | null
  draftYear?: number | null
  nflDraftYear?: number | null
  display?: { metadata?: Record<string, unknown> } | null
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export type NflRookiePolicySource =
  | 'rolling_insights_imported'
  | 'sleeper_years_exp'
  | 'sleeper_cache'
  | 'unknown'

export type NflRookieSourceResolution = {
  isRookie: boolean | null
  source: NflRookiePolicySource
  reason: string
}

export const NFL_ROOKIE_SOURCE_POLICY = {
  order: [
    'verified_imported_db_fields',
    'sleeper_years_exp',
    'sportsdatacache_sleeper_compact',
    'unknown',
  ],
  sleeperZeroMeansRookie: true,
  cacheKey: 'sleeper:nfl:yearsexp:compact:v1',
  note: 'RI NFL doc does not document rookie/draftYear/yearsExperience fields; Sleeper years_exp is fallback.',
} as const

function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function readLoose(player: NflRookiePolicyPlayerLike, key: string): unknown {
  const top = player[key]
  if (top !== undefined && top !== null) return top
  const m = player.metadata
  if (m && typeof m === 'object' && key in m) return (m as Record<string, unknown>)[key]
  const dm = player.display?.metadata
  if (dm && typeof dm === 'object' && key in dm) return (dm as Record<string, unknown>)[key]
  return undefined
}

function draftYearMatchesSeason(player: NflRookiePolicyPlayerLike, season: number): boolean {
  const looseMeta = readLoose(player, 'metadata')
  let metaDraft: number | null = null
  if (looseMeta && typeof looseMeta === 'object') {
    const o = looseMeta as Record<string, unknown>
    metaDraft = num(o.draftYear) ?? num(o.nflDraftYear)
  }
  const dm = player.display?.metadata as Record<string, unknown> | undefined
  const displayDraft =
    dm && typeof dm === 'object' ? num(dm.draftYear) ?? num(dm.nflDraftYear) : null

  const candidates = [
    num(player.draftYear),
    num(player.nflDraftYear),
    num(readLoose(player, 'draftYear')),
    num(readLoose(player, 'nflDraftYear')),
    metaDraft,
    displayDraft,
  ].filter((n): n is number => n != null)
  return candidates.some((n) => n === season)
}

export type NflRookieSourceInput = NflRookiePolicyPlayerLike & {
  seasonYear?: number
}

export function resolveNflRookieSource(input: NflRookieSourceInput): NflRookieSourceResolution {
  const season =
    input.seasonYear ??
    new Date().getUTCFullYear()

  const dm = input.display?.metadata as Record<string, unknown> | undefined
  const prov = dm?.rookieYearsExpSource

  if (input.isRookie === true || input.rookie === true) {
    return { isRookie: true, source: 'rolling_insights_imported', reason: 'explicit_isRookie_flag' }
  }
  if (readLoose(input, 'isRookie') === true || readLoose(input, 'rookie') === true) {
    return { isRookie: true, source: 'rolling_insights_imported', reason: 'metadata_rookie_flag' }
  }

  const ye =
    num(input.yearsExp) ??
    num(readLoose(input, 'yearsExperience')) ??
    num(readLoose(input, 'years_exp'))
  const exp = num(input.experience) ?? num(readLoose(input, 'experience'))

  if (ye !== null) {
    if (ye === 0) {
      let src: NflRookiePolicySource = 'sleeper_years_exp'
      if (prov === 'sleeper_db_cache') src = 'sleeper_cache'
      else if (prov === 'explicit_imported') src = 'rolling_insights_imported'
      return { isRookie: true, source: src, reason: 'years_exp_zero' }
    }
    return { isRookie: false, source: 'sleeper_years_exp', reason: 'years_exp_positive' }
  }

  if (exp !== null) {
    if (exp === 0) {
      return { isRookie: true, source: 'rolling_insights_imported', reason: 'experience_zero_imported' }
    }
    return { isRookie: false, source: 'rolling_insights_imported', reason: 'experience_positive_imported' }
  }

  if (draftYearMatchesSeason(input, season)) {
    return { isRookie: true, source: 'rolling_insights_imported', reason: 'draft_year_matches_season' }
  }

  return { isRookie: null, source: 'unknown', reason: 'no_imported_or_sleeper_signal' }
}
