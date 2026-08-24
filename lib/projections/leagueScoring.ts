/**
 * League-specific projected points, computed exactly from component stats.
 *
 * The whole reason this is possible: Sleeper's weekly projection payload is keyed
 * by the SAME stat names as a Sleeper league's `scoring_settings` — `rec`,
 * `rec_yd`, `pass_td`, `bonus_rec_te`, `fgm_40_49`, `pts_allow`, and so on. So a
 * league's own projected points are a dot product, not an approximation:
 *
 *     points = Σ  projection[stat] × scoring_settings[stat]
 *
 * A TE-premium league, a 6-point-passing-TD league and an IDP league each get a
 * different, CORRECT number from one ingested row. Nothing is inferred, scaled or
 * guessed — which is the only reason it is safe to put a projection in front of
 * someone at all.
 *
 * ⚠ NEVER DERIVE THIS FROM `pts_ppr`. A total has already collapsed the league's
 * scoring into someone else's rules; you cannot recover TE premium or 6-pt passing
 * TDs from it. Scaling a PPR total to "approximate" another format is exactly the
 * kind of invented number this module exists to avoid.
 */

import {
  resolveProviderScoringStatKey,
  type YahooCapturedStatCategory,
} from '@/lib/scoring-defaults/ScoringKeyAliasResolver'

/**
 * IDP naming variants — the same stat under two names.
 *
 * ⚠ THIS MAP IS LOAD-BEARING, NOT A TIDY-UP. Sleeper PROJECTS idp-prefixed keys
 * (`idp_sack`, `idp_int`) while leagues CONFIGURE the bare names (`sack`, `int`).
 *
 * Measured, not assumed: 54 of 120 production leagues score `sack`, `int`, `ff`
 * and `fum_rec` at non-zero weights. Without these aliases every one of those keys
 * resolves to null for every defensive player, contributing ZERO while the
 * projection still looks perfectly healthy — a silent, uniform undercount across
 * nearly half the leagues in the product.
 *
 * (`tkl` is aliased for the same reason, though in the leagues checked it happens
 * to be weighted 0 — which the zero-weight skip below handles correctly.)
 */
const STAT_ALIASES: Record<string, string[]> = {
  tkl: ['idp_tkl'],
  tkl_ast: ['idp_tkl_ast'],
  tkl_solo: ['idp_tkl_solo'],
  tkl_loss: ['idp_tkl_loss'],
  sack: ['idp_sack'],
  sack_yd: ['idp_sack_yd'],
  int: ['idp_int'],
  ff: ['idp_ff'],
  fum_rec: ['idp_fum_rec'],
  pass_def: ['idp_pass_def'],
  qb_hit: ['idp_qb_hit'],
  safe: ['idp_safe'],
  int_ret_yd: ['idp_int_ret_yd'],
  fum_ret_yd: ['idp_fum_ret_yd'],
}

export type LeagueScoringResult = {
  /** Projected points under this league's own scoring. */
  points: number
  /** Stat keys that contributed, with their point contribution. */
  contributions: Record<string, number>
  /**
   * How much of the league's scoring rulebook this projection could actually
   * speak to — see `coverage` below for why this is reported rather than hidden.
   */
  coverage: {
    scoredKeys: number
    matchedKeys: number
    /**
     * Scoring keys with no projected stat behind them.
     *
     * ⚠ MOSTLY BENIGN — DO NOT READ THIS AS AN ERROR RATE. A wide receiver has no
     * projected `pass_td`, `fgm_40_49` or `idp_sack`, so a WR in a 128-key IDP
     * league legitimately matches ~9 keys. Low match counts are the normal case,
     * not a defect. `unusedProjectedStats` below is the field that actually
     * indicates something is wrong.
     */
    unmatched: string[]
    /**
     * Projected stats with a real non-zero value that NO scoring key consumed.
     *
     * ⚠ THIS IS THE ALIAS-GAP DETECTOR, AND THE ONLY COVERAGE SIGNAL WORTH
     * ALERTING ON. If a player is projected for 6.2 tackles and the league scores
     * `tkl`, but nothing consumed `idp_tkl`, those points vanish silently and the
     * projection still looks perfectly healthy. Anything appearing here is either a
     * naming variant needing an alias, or a stat this league genuinely does not
     * score — and the two are worth telling apart.
     */
    unusedProjectedStats: string[]
  }
}

/** Stats that are never scoring inputs — totals, ranks and metadata. */
const NON_SCORING_STATS = new Set([
  'adp_dd_ppr',
  'pos_adp_dd_ppr',
  'pts_ppr',
  'pts_half_ppr',
  'pts_std',
  'gp',
  'gms_active',
  'cmp_pct',
  'pos_rank_ppr',
  'pos_rank_std',
  'pos_rank_half_ppr',
])

function readNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Resolve a league scoring key to the projection value behind it, following
 * aliases when the direct name is absent.
 */
function projectedValueFor(
  scoringKey: string,
  projection: Record<string, unknown>
): number | null {
  const direct = readNumber(projection[scoringKey])
  if (direct != null) return direct
  for (const alias of STAT_ALIASES[scoringKey] ?? []) {
    const v = readNumber(projection[alias])
    if (v != null) return v
  }
  return null
}

/**
 * Compute a league's projected points from component stats.
 *
 * ⚠ AN UNMATCHED KEY CONTRIBUTES ZERO, AND THAT IS USUALLY CORRECT — but not
 * always, which is why `coverage` comes back with the number instead of being
 * swallowed. Most unmatched keys are events nobody projects because their expected
 * value really is ~0 (`st_ff`, `def_st_td`, `fum_rec_td`, `pts_allow_0`); treating
 * those as 0 is right. But an unmatched key can also mean a naming variant we have
 * not aliased, and that would quietly suppress real points. The caller can see the
 * difference; a bare number could not.
 */
export function computeLeagueProjectedPoints(
  projection: Record<string, unknown> | null | undefined,
  scoringSettings: Record<string, unknown> | null | undefined
): LeagueScoringResult | null {
  if (!projection || typeof projection !== 'object') return null
  if (!scoringSettings || typeof scoringSettings !== 'object') return null

  const contributions: Record<string, number> = {}
  const unmatched: string[] = []
  const consumed = new Set<string>()
  let points = 0
  let matchedKeys = 0
  let scoredKeys = 0

  for (const [key, rawWeight] of Object.entries(scoringSettings)) {
    const weight = readNumber(rawWeight)
    // A zero weight is not a gap — the league scores that stat at nothing on
    // purpose, so it belongs in neither the matched nor the unmatched count.
    if (weight == null || weight === 0) continue
    scoredKeys++

    const value = projectedValueFor(key, projection)
    if (value == null) {
      unmatched.push(key)
      continue
    }

    matchedKeys++
    consumed.add(key)
    for (const alias of STAT_ALIASES[key] ?? []) consumed.add(alias)
    const contribution = value * weight
    if (contribution !== 0) contributions[key] = contribution
    points += contribution
  }

  /*
   * ⚠ ZERO MATCHED KEYS IS NOT A ZERO-POINT PROJECTION — IT IS NO PROJECTION.
   * Caught on real data: a production league carried only two non-zero scoring
   * keys, matched none of them, and this function happily returned 0.00 points —
   * which renders as a confident "this player will score nothing" rather than as
   * "we cannot score this league". Returning null forces the caller to say the
   * latter.
   */
  if (matchedKeys === 0) return null

  const unusedProjectedStats = Object.entries(projection)
    .filter(([k, v]) => {
      if (consumed.has(k) || NON_SCORING_STATS.has(k)) return false
      const n = readNumber(v)
      return n != null && n !== 0
    })
    .map(([k]) => k)

  return {
    // Two decimals: the inputs are themselves projections carrying far more
    // precision than they earn, and printing 17.482913 implies a certainty the
    // underlying model does not have.
    points: Math.round(points * 100) / 100,
    contributions,
    coverage: { scoredKeys, matchedKeys, unmatched, unusedProjectedStats },
  }
}

/** Yahoo JSON collections arrive as arrays OR `{0:…,1:…,count}` objects; yield the items either way. */
function yahooCollectionItems(source: unknown): unknown[] {
  if (Array.isArray(source)) return source
  if (source && typeof source === 'object') {
    return Object.entries(source as Record<string, unknown>)
      .filter(([k]) => k !== 'count')
      .map(([, v]) => v)
  }
  return []
}

/** Merge a Yahoo entity that may be a plain object or an array of fragment objects. */
function mergeYahooFragments(entity: unknown): Record<string, unknown> {
  if (Array.isArray(entity)) {
    const fragments = Array.isArray(entity[0]) ? entity[0] : entity
    const merged: Record<string, unknown> = {}
    for (const fragment of fragments) {
      if (fragment && typeof fragment === 'object' && !Array.isArray(fragment)) {
        Object.assign(merged, fragment)
      }
    }
    return merged
  }
  if (entity && typeof entity === 'object') return { ...(entity as Record<string, unknown>) }
  return {}
}

/**
 * Pull `stat_id → {name, displayName, positionType}` out of the RAW Yahoo
 * settings the import persisted at `settings.yahoo_settings` (see
 * YahooAdapter). Absent or foreign shapes yield an empty map — the bridge then
 * simply translates nothing for Yahoo, and the rulebook stays honestly
 * uncomputable rather than wrong.
 */
function extractYahooStatCategories(yahooSettings: unknown): Map<string, YahooCapturedStatCategory> {
  const out = new Map<string, YahooCapturedStatCategory>()
  const root = Array.isArray(yahooSettings)
    ? (yahooSettings as unknown[]).find(
        (f) => f && typeof f === 'object' && 'stat_categories' in (f as Record<string, unknown>)
      )
    : yahooSettings
  if (!root || typeof root !== 'object') return out
  const categories = (root as Record<string, unknown>).stat_categories
  const stats =
    categories && typeof categories === 'object'
      ? (categories as Record<string, unknown>).stats
      : null
  for (const wrapper of yahooCollectionItems(stats)) {
    const stat = mergeYahooFragments(
      wrapper && typeof wrapper === 'object' && 'stat' in (wrapper as Record<string, unknown>)
        ? (wrapper as Record<string, unknown>).stat
        : wrapper
    )
    const statId = stat.stat_id != null ? String(stat.stat_id) : ''
    if (!statId) continue
    out.set(statId, {
      name: typeof stat.name === 'string' ? stat.name : null,
      displayName: typeof stat.display_name === 'string' ? stat.display_name : null,
      positionType: typeof stat.position_type === 'string' ? stat.position_type : null,
    })
  }
  return out
}

/**
 * ESPN/Yahoo rulebooks are captured at import under provider-namespaced keys
 * (`espn_stat_<id>` / `yahoo_stat_<id>`) inside the settings snapshot
 * (`settings.scoringSettings.rules` — see canonicalImportNormalizer), which no
 * projection could ever consume: none of those keys matches a projected stat.
 * This bridge translates the VERIFIABLE ones to Sleeper projection keys.
 * Untranslatable non-null rules are KEPT under their provider key on purpose —
 * `computeLeagueProjectedPoints` then reports them in `coverage.unmatched`
 * instead of silently pretending the league scores fewer stats than it does.
 * Returns null when nothing translated (no invented rulebook; Sleeper-keyed
 * and native snapshots fall through to the legacy path unchanged).
 */
function bridgeProviderScoringRules(s: Record<string, unknown>): Record<string, unknown> | null {
  const snapshot = s.scoringSettings
  const rules =
    snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? (snapshot as Record<string, unknown>).rules
      : null
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return null

  const yahooStatCategoriesById = extractYahooStatCategories(s.yahoo_settings)
  const bridged: Record<string, unknown> = {}
  let translated = 0
  for (const [key, value] of Object.entries(rules as Record<string, unknown>)) {
    const weight = readNumber(value)
    if (weight == null) continue
    const canonical = resolveProviderScoringStatKey(key, { yahooStatCategoriesById })
    if (canonical) {
      translated++
      bridged[canonical] = weight
    } else {
      bridged[key] = weight
    }
  }
  return translated > 0 ? bridged : null
}

/**
 * Pull `scoring_settings` out of a stored `League.settings` snapshot.
 *
 * Returns null rather than an empty object when absent: an empty rulebook would
 * score every player at exactly 0.00, which renders as a real projection of zero
 * instead of as "we do not have this league's scoring".
 */
export function extractScoringSettings(
  leagueSettings: unknown
): Record<string, unknown> | null {
  if (!leagueSettings || typeof leagueSettings !== 'object') return null
  const s = leagueSettings as Record<string, unknown>
  // Provider-captured rulebooks (ESPN/Yahoo) translate first; anything else
  // falls through to the original behavior untouched.
  const bridged = bridgeProviderScoringRules(s)
  if (bridged) return bridged
  const scoring = s.scoring_settings ?? s.scoringSettings
  if (!scoring || typeof scoring !== 'object') return null
  const rec = scoring as Record<string, unknown>
  return Object.keys(rec).length > 0 ? rec : null
}
