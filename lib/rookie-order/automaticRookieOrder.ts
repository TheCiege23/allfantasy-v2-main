/**
 * The automatic rookie draft order — worst record first, or lowest max PF first, with the playoff teams
 * by finish — is an AF Commissioner (or AF Supreme) setting, OFF by default (owner's decision, 2026-10-29).
 *
 * 🛑 IT USED TO RUN FOR EVERY DYNASTY LEAGUE. `createNextLeagueDraft` seated each new rookie draft from last
 * season's standings by the dynasty config's method (`max_pf` unless changed), whatever the league had
 * switched on and whatever its commissioner's plan. Now standings seat the rookie draft only when the
 * commissioner switched the automatic order on (`settings.rookie_draft_order {enabled, mode}`, saved
 * through `/rookie-draft-order`, which already requires AF Commissioner to turn it on) AND still holds the
 * plan when the draft is created. Otherwise the draft takes the league's own order (the commissioner's
 * draft order, or the default seating).
 *
 * The weighted lottery is its own setting and is unchanged; so is the live rookie order.
 */
import { isLeagueEntitledToLiveRookieOrder } from './liveRookieOrderService'

export type AutomaticRookieOrderMethod = 'max_pf' | 'reverse_standings'

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** PURE: the standings method the automatic order asks for, or null when it is off. */
export function automaticRookieOrderFromSettings(settings: unknown): AutomaticRookieOrderMethod | null {
  const rookie = record(record(settings).rookie_draft_order)
  if (rookie.enabled !== true) return null
  return rookie.mode === 'reverse_max_pf' ? 'max_pf' : 'reverse_standings'
}

/**
 * The standings method to seat the next rookie draft with, or null. Switched on AND the commissioner still
 * entitled; a failed entitlement check counts as not entitled (the league's own order is never wrong).
 */
export async function automaticRookieOrderMethod(
  league: { userId: string | null; settings: unknown },
  deps: { isEntitled?: (userId: string) => Promise<boolean> } = {},
): Promise<AutomaticRookieOrderMethod | null> {
  const method = automaticRookieOrderFromSettings(league.settings)
  if (!method || !league.userId) return null
  const isEntitled = deps.isEntitled ?? isLeagueEntitledToLiveRookieOrder
  let entitled = false
  try {
    entitled = (await isEntitled(league.userId)) === true
  } catch {
    entitled = false
  }
  return entitled ? method : null
}
