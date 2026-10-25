/**
 * What the lower bracket plays for: `League.settings.playoff_structure.consolation_plays_for`
 * (`pick` | `cash` | `none`; the settings screens label them "Draft pick", "Cash", "Nothing").
 *
 * ⚠ ONE READER FOR THE BRACKET CONFIG AND THE DRAFT ORDER. `getBracketConfigForLeague` and the
 * next-season draft order (`lib/rookie-order/`) both read it here: playoff_structure first, then
 * the top level, then the sport default (`pick` for NFL/NBA/NHL, `none` for MLB).
 *
 * `pick` is the only value that changes anything outside the bracket. With it, next season's
 * draft order gives pick 1 to the team the lower bracket decided, and every other non-playoff team
 * follows in reverse standings exactly as it would without the setting:
 *
 *   consolation bracket — winners advance, so the consolation winner picks FIRST.
 *   toilet bowl         — losers advance and "last place is decided in the final", so the final's
 *                         loser picks first.
 *
 * `cash` and `none` leave the draft order exactly as it was.
 *
 * 🛑 A STORED `pick` IS NOT ENOUGH TO MOVE THE DRAFT ORDER — `consolationPlaysForSetsDraftOrder` is the
 * draft order's reader. League creation has always written the sport default (`pick` for most sports)
 * into `playoff_structure`, so nearly every existing league stores `pick` without a commissioner ever
 * having chosen it, back when it did nothing. Owner's rollout rule: the draft order follows the
 * setting only for leagues created from now on, and for an existing league once its commissioner
 * saves the setting. Both write `CONSOLATION_PLAYS_FOR_DRAFT_ORDER_KEY: true` beside it — creation in
 * `buildInitialLeagueSettings` and `bootstrapLeaguePlayoffConfig` (only when it is filling the setting
 * in, never beside one already stored), a save in `execute-league-settings-patch` (`consolationPlaysFor`,
 * which `commissionerPlayoffsPatch` forwards). A league without the flag keeps the order it always had.
 * No backfill: nothing writes the flag onto an existing league except its commissioner's save.
 */
import { resolveDefaultPlayoffConfig } from '@/lib/sport-defaults/DefaultPlayoffConfigResolver'
import { toSportType } from '@/lib/sport-defaults/sport-type-utils'

export type ConsolationPlaysFor = 'pick' | 'cash' | 'none'

export const CONSOLATION_PLAYS_FOR_SETTINGS_KEY = 'consolation_plays_for'

/** `playoff_structure` flag: this league's `consolation_plays_for` was set under the draft-order rule. */
export const CONSOLATION_PLAYS_FOR_DRAFT_ORDER_KEY = 'consolation_plays_for_sets_draft_order'

export const CONSOLATION_PLAYS_FOR_VALUES: readonly ConsolationPlaysFor[] = ['pick', 'cash', 'none']

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

/** True once the league was created, or its commissioner saved the setting, under the draft-order rule. */
export function consolationPlaysForAppliesToDraftOrder(settings: unknown): boolean {
  return record(record(settings).playoff_structure)[CONSOLATION_PLAYS_FOR_DRAFT_ORDER_KEY] === true
}

/** Whether next season's draft order seats the lower bracket's result first. */
export function consolationPlaysForSetsDraftOrder(settings: unknown, sport: string | null | undefined, variant?: string | null): boolean {
  return consolationPlaysForAppliesToDraftOrder(settings) && readConsolationPlaysFor(settings, sport, variant) === 'pick'
}

/** A value a save may store, or null. */
export function parseConsolationPlaysFor(value: unknown): ConsolationPlaysFor | null {
  return typeof value === 'string' ? normalize(value) : null
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
