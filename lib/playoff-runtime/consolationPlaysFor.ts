/**
 * What the lower bracket plays for: `League.settings.playoff_structure.consolation_plays_for`
 * (`pick` | `cash` | `none`; the settings screens label them "Draft pick", "Cash", "Nothing").
 *
 * ⚠ ONE READER FOR THE BRACKET CONFIG AND THE DRAFT ORDER. `getBracketConfigForLeague` and the
 * next-season draft order (`lib/rookie-order/`) both read it here: playoff_structure first, then
 * the top level, then the sport default (`pick` for NFL/NBA/NHL, `none` for MLB).
 *
 * `pick` is the only value that changes anything outside the bracket. With it, next season's
 * draft order seats the non-playoff teams by the lower bracket's result instead of by standings:
 *
 *   consolation bracket — winners advance, so the consolation winner picks FIRST and the rest
 *                         follow by consolation finish (the bracket is what they played for).
 *   toilet bowl         — losers advance and "last place is decided in the final", so the final's
 *                         loser picks first and the rest follow worst finish first.
 *
 * `cash` and `none` leave the draft order exactly as it was.
 */
import { resolveDefaultPlayoffConfig } from '@/lib/sport-defaults/DefaultPlayoffConfigResolver'
import { toSportType } from '@/lib/sport-defaults/sport-type-utils'

export type ConsolationPlaysFor = 'pick' | 'cash' | 'none'

export const CONSOLATION_PLAYS_FOR_SETTINGS_KEY = 'consolation_plays_for'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function normalize(value: unknown): ConsolationPlaysFor | null {
  const v = String(value ?? '').trim().toLowerCase()
  return v === 'pick' || v === 'cash' || v === 'none' ? v : null
}

/** The stored value, else the sport default. Anything unrecognised reads as `none`. */
export function readConsolationPlaysFor(settings: unknown, sport: string | null | undefined, variant?: string | null): ConsolationPlaysFor {
  const s = record(settings)
  const raw = record(s.playoff_structure)[CONSOLATION_PLAYS_FOR_SETTINGS_KEY] ?? s[CONSOLATION_PLAYS_FOR_SETTINGS_KEY]
  if (raw != null && raw !== '') return normalize(raw) ?? 'none'
  const fallback = resolveDefaultPlayoffConfig(toSportType(String(sport ?? 'NFL')), variant ?? undefined).consolation_plays_for
  return normalize(fallback) ?? 'none'
}

export type LowerBracketDraftResult = {
  mode: 'consolation' | 'toilet_bowl'
  /** The non-playoff teams, best finish first, once the season's bracket is finalized; else null. */
  finishOrder: string[] | null
}

/**
 * The lower bracket's result as the playoff finalizer wrote it into `RedraftPlayoffBracket.structure`
 * (`lowerBracket`, `finalStandings`). `finishOrder` is null until the bracket is complete, so a caller
 * never seats an order from a bracket that is still being played. Null when there is no lower bracket.
 *
 * `hasLowerBracketRows` covers a season whose bracket is being played: the structure only records the
 * mode at generation, and a bracket written before it did is still a consolation bracket.
 */
export function readLowerBracketDraftResult(structure: unknown, hasLowerBracketRows: boolean): LowerBracketDraftResult | null {
  const s = record(structure)
  const stored = s.lowerBracket
  if (stored === 'none') return null
  const mode = stored === 'toilet_bowl' ? 'toilet_bowl' : stored === 'consolation' || hasLowerBracketRows ? 'consolation' : null
  if (!mode) return null
  const complete = typeof s.championRosterId === 'string' && Array.isArray(s.finalStandings)
  if (!complete) return { mode, finishOrder: null }
  const rows = (s.finalStandings as unknown[])
    .map(record)
    .filter((r) => typeof r.rosterId === 'string' && typeof r.finish === 'number' && r.seed == null)
    .sort((a, b) => (a.finish as number) - (b.finish as number))
  return { mode, finishOrder: rows.map((r) => r.rosterId as string) }
}
