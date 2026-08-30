import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { AiAdpLeagueType } from './types'

export interface AiAdpSegmentContext {
  sport: string
  leagueType: AiAdpLeagueType
  formatKey: string
}

function normalizeFormatToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/\s+/g, '-')
}

/**
 * Recognised scoring styles only. Returns null when the token names nothing we understand.
 */
function coerceKnownFormatKey(token: string): string | null {
  if (!token) return null
  if (token.includes('superflex') || token === 'sf' || token.includes('2qb')) return 'sf'
  if (token.includes('half') && token.includes('ppr')) return 'half-ppr'
  if (token.includes('ppr')) return 'ppr'
  if (token.includes('non-ppr') || token.includes('std') || token.includes('standard')) return 'standard'
  if (token.includes('points')) return 'standard'
  return null
}

/**
 * Structured-field coercion. Keeps the long-standing permissive tail: a value in a field
 * NAMED for the format is a format claim, so an unrecognised one is passed through rather
 * than discarded.
 *
 * ⚠ Deliberately NOT used for prose — see {@link resolveAiAdpFormatKeyFromSettings}.
 */
function coerceFormatKeyFromToken(token: string): string {
  if (!token) return 'default'
  return coerceKnownFormatKey(token) ?? token.slice(0, 32)
}

/**
 * Free-text settings that describe the league in prose rather than in fields.
 *
 * `settings.scoring` is the important one: in production it is a STRING like
 * `'PPR Superflex TEP'` on every real NFL league, not the numeric object
 * {@link resolveFromScoringObject} expects.
 */
const FREE_TEXT_FORMAT_KEYS = [
  'scoring',
  'scoringType',
  'format',
  'formatKey',
  'roster_format',
  'league_type',
  'leagueVariant',
  'league_variant',
] as const

/**
 * 🛑 SUPERFLEX IS A ROSTER FACT AND IT WAS BEING SILENTLY DROPPED.
 *
 * The old check looked only at the booleans `is_superflex` / `superflex` / `isSuperflex`.
 * No real league sets any of them. What they DO set is a prose `settings.scoring` — and
 * because that string never reached {@link coerceFormatKeyFromToken} (it is absent from
 * `formatCandidates`, and `resolveFromScoringObject` bails on a non-object), superflex
 * vanished. Measured on production, redraft NFL sessions in the job's lookback:
 *
 *   'PPR Superflex'      + no scoring_format   -> 'default'    (3 drafts)
 *   'PPR Superflex TEP'  + no scoring_format   -> 'default'    (3 drafts)
 *   'PPR Superflex TEP'  + scoring_format half -> 'half-ppr'   (2 drafts)
 *   'PPR Superflex'      + scoring_format half -> 'half-ppr'   (1 draft)
 *
 * Nine superflex drafts, split across two segments, neither named superflex, and pooled with
 * a genuine 1QB PPR league. A superflex board is a different market — quarterbacks move up a
 * round or more — so this was not coarse labelling, it was the wrong board under a confident
 * name.
 *
 * Detecting it MERGES those nine into one honest `sf` segment rather than fragmenting
 * further, which also lifts the sample above the publish floor.
 */
function detectSuperflex(source: Record<string, unknown>): boolean {
  if (source.is_superflex === true || source.superflex === true || source.isSuperflex === true) {
    return true
  }
  for (const key of FREE_TEXT_FORMAT_KEYS) {
    const raw = source[key]
    if (typeof raw !== 'string') continue
    const token = normalizeFormatToken(raw)
    // Word-boundary on `sf` so an unrelated word containing those letters cannot match.
    if (token.includes('superflex') || token.includes('2qb') || /(^|-)sf(-|$)/.test(token)) {
      return true
    }
  }
  return false
}

function resolveFromScoringObject(scoring: unknown): string | null {
  if (!scoring || typeof scoring !== 'object') return null
  const rec = scoring as Record<string, unknown>
  const ppr = typeof rec.ppr === 'number' ? rec.ppr : null
  const isSuperflex =
    rec.superflex === true ||
    rec.isSuperflex === true ||
    rec.is_superflex === true
  if (isSuperflex) return 'sf'
  if (ppr === 0.5) return 'half-ppr'
  if (ppr === 0) return 'standard'
  if (ppr != null && ppr >= 1) return 'ppr'
  return null
}

export function resolveAiAdpLeagueType(input: {
  isDynasty?: boolean | null
  leagueType?: string | null
  settings?: Record<string, unknown> | null
}): AiAdpLeagueType {
  if (input.isDynasty === true) return 'dynasty'
  const explicitLeagueType = normalizeFormatToken(String(input.leagueType ?? ''))
  if (explicitLeagueType.includes('dynasty')) return 'dynasty'
  const settings = input.settings ?? {}
  const candidates = [
    String(settings.league_type ?? ''),
    String(settings.leagueVariant ?? settings.league_variant ?? ''),
    String(settings.roster_format_type ?? ''),
    String(settings.scoring_format_type ?? ''),
    String(settings.roster_format ?? ''),
    String(settings.scoring_format ?? ''),
  ]
  if (candidates.some((v) => normalizeFormatToken(v).includes('dynasty'))) return 'dynasty'
  return 'redraft'
}

export function resolveAiAdpFormatKeyFromSettings(
  settings?: Record<string, unknown> | null
): string {
  const source = settings ?? {}

  /*
   * Superflex is checked FIRST and across every signal, including prose. It outranks the
   * scoring style deliberately, matching what `coerceFormatKeyFromToken` already does when a
   * token names both — one key cannot express both axes, and quarterback scarcity moves a
   * board further than half a point per reception does.
   */
  if (detectSuperflex(source)) return 'sf'

  const scoringObject = resolveFromScoringObject(source.scoring)
  if (scoringObject) return scoringObject

  /*
   * ⚠ `scoring_format_type` IS DELIBERATELY ABSENT, AND USED TO BE FIRST.
   *
   * It is a LEAGUE-TYPE field, not a scoring field — `resolveAiAdpLeagueType` above reads it
   * looking for 'dynasty', which is what its values mean. Feeding it to a scoring coercer let
   * the league-type value 'standard' coerce to the standard SCORING key, so a league with
   * `scoring_format: 'ppr'` and `scoring_format_type: 'standard'` was published as non-PPR.
   * Two production drafts sat in that segment.
   *
   * Dropped rather than demoted: any value it holds is a league-type value, so it can only
   * mislead here. A league that sets nothing else now returns 'default' — honestly unknown —
   * instead of asserting a scoring style nobody stated.
   *
   * `scoring` is handled AFTER these, and differently — see below.
   */
  const formatCandidates = [
    source.scoring_format,
    source.scoringType,
    source.formatKey,
    source.format,
    source.roster_format_type,
    source.roster_format,
  ]

  for (const candidate of formatCandidates) {
    // Strings only: `String({})` is '[object Object]', which coerces to a junk 32-char key.
    if (typeof candidate !== 'string') continue
    const token = normalizeFormatToken(candidate)
    if (!token) continue
    return coerceFormatKeyFromToken(token)
  }

  /*
   * ⚠ PROSE IS READ LAST AND STRICTLY — it may only CONFIRM a style we recognise, never
   * invent a segment key.
   *
   * `settings.scoring` is free text a human typed. Passing it through the permissive tail
   * would let any league name become a formatKey: a league called 'devy' produced a real
   * `devy` segment in this dataset, and 'Best Ball Bonanza' would have produced another.
   * That is the same category error as the `scoring_format_type` note above — a value that
   * is not a scoring style being published as one — so unrecognised prose yields 'default',
   * which honestly means "not stated".
   *
   * It is last because a precise field beats a loose one: `scoring_format: 'half_ppr'`
   * beside `scoring: 'PPR'` is one league saying the same thing twice, once exactly.
   */
  if (typeof source.scoring === 'string') {
    const fromProse = coerceKnownFormatKey(normalizeFormatToken(source.scoring))
    if (fromProse) return fromProse
  }

  return 'default'
}

export function resolveAiAdpSegmentContext(input: {
  sport?: string | null
  isDynasty?: boolean | null
  leagueType?: string | null
  settings?: Record<string, unknown> | null
}): AiAdpSegmentContext {
  return {
    sport: normalizeToSupportedSport(input.sport ?? 'NFL'),
    leagueType: resolveAiAdpLeagueType(input),
    formatKey: resolveAiAdpFormatKeyFromSettings(input.settings),
  }
}
