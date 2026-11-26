/**
 * Which end of the Chop page's list the chop zone sits at (owner's decision, 2026-11-25).
 *
 *   chop_top     the team being chopped leads the list, the safest team closes it. The default: it is what
 *                Sleeper's Chopped page and Yahoo's Death Leagues both do, so a manager arriving from either
 *                finds the list the way they know it.
 *   chop_bottom  the safest team leads and the chop zone closes the list, the way a standings table reads.
 *
 * A display choice, not a rule: it changes no score, tier or chop. Stored in `League.settings`; absent means the
 * default, so every league that never opened the setting reads `chop_top`. Free for every commissioner
 * (see GUILLOTINE_PAID_RULE_FIELDS in ./guillotineRules.ts, which does not list it).
 *
 * Pure, so the board, the settings page and the server all read this one definition.
 */
export type ChopListOrder = 'chop_top' | 'chop_bottom'

/** League.settings key. Absent = DEFAULT_CHOP_LIST_ORDER. */
export const CHOP_LIST_ORDER_KEY = 'guillotineChopListOrder'

export const DEFAULT_CHOP_LIST_ORDER: ChopListOrder = 'chop_top'

export const CHOP_LIST_ORDER_OPTIONS: ReadonlyArray<{ value: ChopListOrder; label: string; help: string }> = [
  { value: 'chop_top', label: 'Chop zone on top', help: 'The team being chopped leads the list. This is how Sleeper and Yahoo show it.' },
  { value: 'chop_bottom', label: 'Chop zone at the bottom', help: 'The safest team leads the list and the chop zone closes it, like a standings table.' },
]

export function isChopListOrder(value: unknown): value is ChopListOrder {
  return value === 'chop_top' || value === 'chop_bottom'
}

export function readChopListOrder(settings: unknown): ChopListOrder {
  const v = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[CHOP_LIST_ORDER_KEY] : null
  return isChopListOrder(v) ? v : DEFAULT_CHOP_LIST_ORDER
}
