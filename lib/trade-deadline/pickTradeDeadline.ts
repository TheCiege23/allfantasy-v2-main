/**
 * A SEPARATE DEADLINE FOR PICK TRADES — dynasty leagues only (docs/commissioner/DYNASTY_COMMISH_CHECKLIST.md).
 *
 * In dynasty, picks trade all year: a team out of the race sells next year's 1st in week 14, long
 * after the deadline has closed player trades so nobody can stack a playoff roster. One deadline for
 * both stops that. So the commissioner can give pick trades their own rule:
 *
 *   same   pick trades close with the trade deadline (the default, and the behaviour before this)
 *   open   pick trades stay open all season
 *   week   pick trades close after week N — before or after the player deadline
 *
 * A PICK TRADE IS ONE IN WHICH EVERY ITEM IS A DRAFT PICK. A deal with any player in it, or any FAAB,
 * is a player trade and keeps the trade deadline: the player deadline exists to freeze rosters and
 * waiver budgets for the stretch run, and a pick riding along must not carry a player past it.
 *
 * The rule binds the in-season window only, exactly like the trade deadline
 * (./tradeDeadlineWindow.ts): out of season nothing closes. The trade deadline's close time
 * (`trade_deadline_at`) is the player deadline's; under `open` or `week` it does not close pick trades.
 *
 * Stored in `League.settings.pick_trade_deadline`; absent means `same`. Free.
 *
 * Pure, and safe to import from a client component.
 */
import { isDynastyFamilyLeague } from '@/lib/redraft/offseason/dynastyFamily'

export const PICK_TRADE_DEADLINE_KEY = 'pick_trade_deadline'

export type PickTradeDeadline = { mode: 'same' } | { mode: 'open' } | { mode: 'week'; week: number }

/** The item types that are draft picks, in either trade engine's vocabulary. */
const PICK_ITEM_TYPES: ReadonlySet<string> = new Set(['rookie_pick', 'devy_pick', 'future_pick'])

const SAME: PickTradeDeadline = { mode: 'same' }

const asObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

function shape(raw: unknown): PickTradeDeadline | null {
  const o = asObject(raw)
  if (!o) return null
  if (o.mode === 'same' || o.mode === 'open') return { mode: o.mode }
  if (o.mode === 'week' && Number.isInteger(o.week) && (o.week as number) >= 1 && (o.week as number) <= 52) return { mode: 'week', week: o.week as number }
  return null
}

/** The stored rule; anything unreadable is `same`, which is what the league did before the rule existed. */
export function readPickTradeDeadline(settings: unknown): PickTradeDeadline {
  return shape(asObject(settings)?.[PICK_TRADE_DEADLINE_KEY]) ?? SAME
}

export function parsePickTradeDeadline(raw: unknown): { ok: true; value: PickTradeDeadline } | { ok: false; error: string } {
  const value = shape(raw)
  if (!value) return { ok: false, error: 'Pick trades close with the trade deadline, stay open all season, or close after a week from 1 to 52.' }
  return { ok: true, value }
}

/** The rule that applies to this league: only a dynasty-family league has one; every other league is `same`. */
export function pickTradeDeadlineFor(league: { leagueType?: string | null; isDynasty?: boolean | null; settings?: unknown }): PickTradeDeadline {
  return isDynastyFamilyLeague(league) ? readPickTradeDeadline(league.settings) : SAME
}

/** Every item is a draft pick. An empty trade is not a pick trade. */
export function isPicksOnlyTrade(items: ReadonlyArray<{ itemType?: string | null }>): boolean {
  return items.length > 0 && items.every((i) => PICK_ITEM_TYPES.has(String(i.itemType ?? '')))
}

/** Has the pick rule closed pick trades? `currentWeek` is the server's in-season week, null out of season. */
export function pickTradeDeadlinePassed(rule: Exclude<PickTradeDeadline, { mode: 'same' }>, window: { inSeason: boolean; currentWeek: number | null }): boolean {
  if (rule.mode === 'open' || !window.inSeason || window.currentWeek == null) return false
  return window.currentWeek > rule.week
}

/** The pick-trade rule a trades screen shows (`loadPickTradeDeadlineView`); null there when pick trades follow the deadline. */
export type PickTradeDeadlineView = { mode: 'open' | 'week'; week: number | null; passed: boolean }

export function pickTradeDeadlinePassedMessage(week: number): string {
  return `Pick trades closed after Week ${week}.`
}
