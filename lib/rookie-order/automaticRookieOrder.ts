/**
 * The automatic rookie draft order: last season's standings seat the next rookie draft.
 *
 * WORST RECORD FIRST IS THE FREE DEFAULT (owner's decision, 2026-11-19). A dynasty league that has
 * said nothing seats its rookie draft worst record first, with the playoff teams by finish and the
 * champion last. That reverses the 2026-10-29 rule that standings seat nothing unless an AF
 * Commissioner league switched the automatic order on: under it a free league's rookie draft fell
 * back to the startup seating, so last season's champion could pick first.
 *
 * What a league can still say:
 *   - `settings.rookie_draft_order.enabled === false` (the settings toggle, free): no automatic order;
 *     the draft takes the league's own order.
 *   - the dynasty settings' order method `commissioner`: the same, unless the toggle is switched on.
 *   - `mode: 'reverse_max_pf'` with the toggle on: lowest max PF first. That mode is AF Commissioner
 *     (or AF Supreme), checked when the draft is created; without the plan the draft is seated worst
 *     record first, never left to the startup seating.
 *
 * The weighted lottery and the live rookie order are their own settings and win over this one.
 */
import { isLeagueEntitledToLiveRookieOrder } from './liveRookieOrderService'

export type AutomaticRookieOrderMethod = 'max_pf' | 'reverse_standings'

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** PURE: what the league's toggle says. `unset` is a league that never saved one. */
export function automaticRookieOrderSwitch(settings: unknown): 'on' | 'off' | 'unset' {
  const enabled = record(record(settings).rookie_draft_order).enabled
  return enabled === true ? 'on' : enabled === false ? 'off' : 'unset'
}

/**
 * PURE: the standings method the league asks for, or null when it seats its own order. `configMethod`
 * is the dynasty settings' order method (`DynastyLeagueConfig.rookiePickOrderMethod`), when known.
 */
export function automaticRookieOrderFromSettings(
  settings: unknown,
  configMethod?: string | null,
): AutomaticRookieOrderMethod | null {
  const state = automaticRookieOrderSwitch(settings)
  if (state === 'off') return null
  if (state === 'unset') return configMethod === 'commissioner' ? null : 'reverse_standings'
  return record(record(settings).rookie_draft_order).mode === 'reverse_max_pf' ? 'max_pf' : 'reverse_standings'
}

/**
 * The standings method to seat the next rookie draft with, or null. Worst record first needs no plan.
 * Lowest max PF needs the commissioner's plan when the draft is created; a missing plan, or a plan
 * check that failed, seats worst record first.
 */
export async function automaticRookieOrderMethod(
  league: { userId: string | null; settings: unknown },
  deps: { isEntitled?: (userId: string) => Promise<boolean>; configMethod?: string | null } = {},
): Promise<AutomaticRookieOrderMethod | null> {
  const method = automaticRookieOrderFromSettings(league.settings, deps.configMethod)
  if (method !== 'max_pf') return method
  if (!league.userId) return 'reverse_standings'
  const isEntitled = deps.isEntitled ?? isLeagueEntitledToLiveRookieOrder
  let entitled = false
  try {
    entitled = (await isEntitled(league.userId)) === true
  } catch {
    entitled = false
  }
  return entitled ? 'max_pf' : 'reverse_standings'
}
