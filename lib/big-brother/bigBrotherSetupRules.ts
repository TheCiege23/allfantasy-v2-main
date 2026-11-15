/**
 * The Big Brother rules a commissioner picks in league setup, as the game reads them (2026-11-15).
 *
 * 🛑 THE SETUP CHOICES NEVER REACHED THE GAME. The creation wizard saved finale format, jury start, HOH challenge
 * mode, eviction tie-break and consecutive HOH into `League.settings.big_brother_*`, and nothing ever read those keys.
 * Both bootstraps created the game's `BigBrotherLeagueConfig` with `upsertBigBrotherConfig(leagueId, {})`, so every
 * league ran on the built-in defaults — a commissioner who picked "HOH breaks the tie" got ties broken on season
 * points, and "Fantasy score" HOH challenges ran as "hybrid".
 *
 * Now:
 *   - a new league's config is created FROM its setup choices (`bigBrotherConfigFromSetup`);
 *   - an existing league gets its setup choices once, but ONLY where its config still holds the built-in default
 *     (`setupRulesForExistingLeague`) — a value someone set since is never overwritten.
 *
 * ⚠ JURY START NEEDS A NUMBER THE OLD WIZARD NEVER ASKED FOR. "When X houseguests remain" and "fixed week" were
 * offered without asking for X or the week, and the engine reads a missing number as 0: "when 0 remain" never starts
 * a jury, and "from week 0" starts one at the first eviction. So a missing count for `when_remaining` becomes
 * finalists + 7 (the same seven-member jury the default "after 7 evictions" gives), and `fixed_week` without a week
 * is not applied at all — the league keeps "after 7 evictions" rather than a jury from week one.
 *
 * Pure (no I/O).
 */
import type { BigBrotherConfigUpsertInput } from './BigBrotherLeagueConfig'

export const SETUP_RULES_APPLIED_KEY = 'big_brother_setup_rules_applied_at'

/** The jurors a default league ends with ("after 7 evictions"); the when-remaining fallback keeps the same jury. */
const DEFAULT_JURORS = 7

const FINALE = new Set(['final_2', 'final_3'])
const JURY = new Set(['after_eliminations', 'when_remaining', 'fixed_week'])
const CHALLENGE = new Set(['deterministic_score', 'hybrid', 'ai_theme'])
const TIE_BREAK = new Set(['hoh_vote', 'season_points', 'random', 'commissioner'])

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function positiveInt(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null
}

/** The game config the setup choices ask for. Unknown or missing values are left out (the default stands). */
export function bigBrotherConfigFromSetup(settings: unknown): BigBrotherConfigUpsertInput {
  const s = isRecord(settings) ? settings : {}
  const out: BigBrotherConfigUpsertInput = {}
  const finale = typeof s.big_brother_finale_format === 'string' && FINALE.has(s.big_brother_finale_format) ? s.big_brother_finale_format : null
  if (finale) out.finaleFormat = finale
  if (typeof s.big_brother_challenge_mode === 'string' && CHALLENGE.has(s.big_brother_challenge_mode)) out.challengeMode = s.big_brother_challenge_mode
  if (typeof s.big_brother_tie_break === 'string' && TIE_BREAK.has(s.big_brother_tie_break)) out.evictionTieBreakMode = s.big_brother_tie_break
  if (typeof s.big_brother_consecutive_hoh === 'boolean') out.consecutiveHohAllowed = s.big_brother_consecutive_hoh

  const jury = typeof s.big_brother_jury_mode === 'string' && JURY.has(s.big_brother_jury_mode) ? s.big_brother_jury_mode : null
  const juryValue = positiveInt(s.big_brother_jury_value)
  if (jury === 'after_eliminations') {
    out.juryStartMode = jury
    if (juryValue) out.juryStartAfterEliminations = juryValue
  } else if (jury === 'when_remaining') {
    out.juryStartMode = jury
    out.juryStartWhenRemaining = juryValue ?? (finale === 'final_3' ? 3 : 2) + DEFAULT_JURORS
  } else if (jury === 'fixed_week' && juryValue) {
    out.juryStartMode = jury
    out.juryStartWeek = juryValue
  }
  return out
}

type ConfigLike = Record<string, unknown>

/**
 * The setup choices to apply to a league that already has a config: only the fields still at the built-in default
 * (`defaults`), and only where the setup asked for something different. A jury rule moves as one unit — its mode and
 * its number — and only when the mode is still the default.
 *
 * ⚠ MID-SEASON, ONLY THE RULES THAT DECIDE FUTURE MOMENTS. Tie-break, HOH challenge mode and consecutive HOH govern
 * the next vote or competition, so they apply at any point. Finale format and jury start shape who is already a
 * juror and how the season ends, so once anyone has been evicted they are left as they are (`evictionsSoFar`).
 */
export function setupRulesForExistingLeague(
  settings: unknown,
  config: ConfigLike,
  defaults: ConfigLike,
  opts: { evictionsSoFar: number },
): BigBrotherConfigUpsertInput {
  const wanted = bigBrotherConfigFromSetup(settings)
  const out: BigBrotherConfigUpsertInput = {}
  const atDefault = (key: string) => config[key] === defaults[key]
  const beforeFirstEviction = opts.evictionsSoFar === 0
  const keys = ['challengeMode', 'evictionTieBreakMode', 'consecutiveHohAllowed', ...(beforeFirstEviction ? (['finaleFormat'] as const) : [])] as const
  for (const key of keys) {
    if (wanted[key] !== undefined && wanted[key] !== config[key] && atDefault(key)) (out as Record<string, unknown>)[key] = wanted[key]
  }
  const juryKeys = ['juryStartMode', 'juryStartAfterEliminations', 'juryStartWhenRemaining', 'juryStartWeek'] as const
  if (beforeFirstEviction && wanted.juryStartMode && juryKeys.every(atDefault)) {
    const changes = juryKeys.filter((k) => wanted[k] !== undefined && wanted[k] !== config[k])
    for (const k of changes) (out as Record<string, unknown>)[k] = wanted[k]
  }
  return out
}
