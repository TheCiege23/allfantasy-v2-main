/**
 * THE PAYOUT CALCULATOR — what each team is owed at the end of the season, worked out from the
 * league's buy-in, the commissioner's place split and the weekly side contests.
 *
 *   pot            buy-in × teams
 *   weekly prizes  the side contests' prize per week × regular-season weeks, set aside first
 *                  (lib/side-contests/sideContests.ts — what has been won so far comes from there)
 *   place pool     what is left, split by the commissioner's percent per finishing place
 *   per team       its place money + the weekly prizes it has won
 *
 * Places come from the season's final standings once the bracket is complete; before that they are
 * the current standings order, labelled "if the season ended today". Amounts are whole cents and the
 * place amounts always add up to the place pool exactly: any cent left by rounding goes to first.
 *
 * AllFantasy tracks the money; it does not collect, hold or pay it. Pure.
 */

/** League.settings key. "payout" in the name files it under the co-commissioner MONEY scope. */
export const PAYOUT_PLAN_KEY = 'payout_plan'

export const MAX_PAYOUT_PLACES = 10
/** $10,000 a team is far past any real home league; anything bigger is a typo. */
export const MAX_BUY_IN_CENTS = 1_000_000

export type PayoutPlan = {
  /** Null: use the league's entry fee. */
  buyInCents: number | null
  /** Percent of the place pool per place, first place first. Whole numbers. */
  placePercents: number[]
}

export const EMPTY_PAYOUT_PLAN: PayoutPlan = { buyInCents: null, placePercents: [] }

const isCents = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max
const isPercent = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100

/** The stored plan, or the empty plan when there is none or it is malformed. */
export function readPayoutPlan(settings: unknown): PayoutPlan {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[PAYOUT_PLAN_KEY] : null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_PAYOUT_PLAN
  const o = raw as Record<string, unknown>
  const percents = Array.isArray(o.placePercents) ? o.placePercents : []
  const valid = percents.length <= MAX_PAYOUT_PLACES && percents.every(isPercent) && percents.reduce((a: number, b) => a + (b as number), 0) <= 100
  return {
    buyInCents: isCents(o.buyInCents, MAX_BUY_IN_CENTS) ? o.buyInCents : null,
    placePercents: valid ? (percents as number[]) : [],
  }
}

/** Dollars as typed ("25", "12.50", 25) to cents; empty is null; anything else is NaN. */
function dollarsToCents(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const s = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim().replace(/^\$/, '') : ''
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN
  return Math.round(Number(s) * 100)
}

export type PayoutPlanParse = { ok: true; value: PayoutPlan } | { ok: false; error: string }

/**
 * A commissioner's save: `{ buyIn, placePercents }`, buy-in in dollars (empty = the league's entry
 * fee). Refused with the reason, never trimmed. Percents may total less than 100 — the rest stays
 * unassigned and the calculator says so — but never more.
 */
export function parsePayoutPlanInput(body: unknown): PayoutPlanParse {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Send the payout plan to save.' }
  const o = body as Record<string, unknown>
  for (const key of Object.keys(o)) {
    if (key !== 'buyIn' && key !== 'placePercents') return { ok: false, error: `Unknown field: ${key}.` }
  }
  const buyInCents = dollarsToCents(o.buyIn)
  if (buyInCents !== null && (!Number.isFinite(buyInCents) || buyInCents > MAX_BUY_IN_CENTS)) {
    return { ok: false, error: 'The buy-in must be an amount in dollars, up to $10,000.' }
  }
  const raw = o.placePercents ?? []
  if (!Array.isArray(raw)) return { ok: false, error: 'Send the place split as a list of percents.' }
  if (raw.length > MAX_PAYOUT_PLACES) return { ok: false, error: `Pay at most ${MAX_PAYOUT_PLACES} places.` }
  const placePercents: number[] = []
  for (const [i, v] of raw.entries()) {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
    if (!isPercent(n)) return { ok: false, error: `Place ${i + 1} must be a whole percent from 0 to 100.` }
    placePercents.push(n)
  }
  const total = placePercents.reduce((a, b) => a + b, 0)
  if (total > 100) return { ok: false, error: `The places add up to ${total}%; they can add up to 100% at most.` }
  return { ok: true, value: { buyInCents, placePercents } }
}

/** A finishing order: one row per team, `place` 1 for first. */
export type PlaceRow = { rosterId: string; place: number }

export type PayoutInput = {
  plan: PayoutPlan
  /** The league's entry fee, used when the plan names no buy-in. */
  entryFeeCents: number
  teamCount: number
  /** Side contests: prize per regular-season week summed over the enabled contests. */
  weeklyPrizeCentsPerWeek: number
  regularSeasonWeeks: number
  /** Weekly prizes won so far, per team (lib/side-contests `prizeTotals`). */
  weeklyPrizesWon: ReadonlyArray<{ rosterId: string; prizeCents: number }>
  /** Final standings when `final`, else the current standings order. */
  order: readonly PlaceRow[]
  final: boolean
}

export type PlacePayout = { place: number; percent: number; cents: number; rosterId: string | null }
export type TeamPayout = { rosterId: string; place: number | null; placeCents: number; weeklyCents: number; totalCents: number }

export type PayoutResult = {
  buyInCents: number
  potCents: number
  weeklyReserveCents: number
  placePoolCents: number
  /** Percent of the place pool no place is assigned (0 when the split totals 100). */
  unassignedPercent: number
  unassignedCents: number
  places: PlacePayout[]
  teams: TeamPayout[]
  final: boolean
  /** Weekly prizes promise more than the pot holds. */
  overCommittedCents: number
}

/** Splits `pool` by `percents` in whole cents; the rounding remainder goes to first place. */
export function splitByPercent(poolCents: number, percents: readonly number[]): number[] {
  const amounts = percents.map((p) => Math.floor((poolCents * p) / 100))
  const totalPercent = percents.reduce((a, b) => a + b, 0)
  const target = Math.floor((poolCents * totalPercent) / 100)
  const remainder = target - amounts.reduce((a, b) => a + b, 0)
  if (amounts.length > 0 && remainder > 0) amounts[0] += remainder
  return amounts
}

export function calculatePayouts(input: PayoutInput): PayoutResult {
  const buyInCents = input.plan.buyInCents ?? Math.max(0, Math.round(input.entryFeeCents))
  const potCents = buyInCents * Math.max(0, input.teamCount)
  const committed = Math.max(0, input.weeklyPrizeCentsPerWeek) * Math.max(0, input.regularSeasonWeeks)
  const weeklyReserveCents = Math.min(committed, potCents)
  const placePoolCents = potCents - weeklyReserveCents
  const percents = input.plan.placePercents
  const amounts = splitByPercent(placePoolCents, percents)
  const assignedPercent = percents.reduce((a, b) => a + b, 0)

  const byPlace = new Map(input.order.map((r) => [r.place, r.rosterId]))
  const places: PlacePayout[] = percents.map((percent, i) => ({
    place: i + 1,
    percent,
    cents: amounts[i] ?? 0,
    rosterId: byPlace.get(i + 1) ?? null,
  }))

  const placeCentsByRoster = new Map<string, number>()
  for (const p of places) if (p.rosterId) placeCentsByRoster.set(p.rosterId, (placeCentsByRoster.get(p.rosterId) ?? 0) + p.cents)
  const weeklyByRoster = new Map(input.weeklyPrizesWon.map((w) => [w.rosterId, w.prizeCents]))
  const placeOf = new Map(input.order.map((r) => [r.rosterId, r.place]))
  const ids = new Set([...input.order.map((r) => r.rosterId), ...weeklyByRoster.keys()])
  const teams: TeamPayout[] = [...ids]
    .map((rosterId) => {
      const placeCents = placeCentsByRoster.get(rosterId) ?? 0
      const weeklyCents = Math.round(weeklyByRoster.get(rosterId) ?? 0)
      return { rosterId, place: placeOf.get(rosterId) ?? null, placeCents, weeklyCents, totalCents: placeCents + weeklyCents }
    })
    .sort((a, b) => b.totalCents - a.totalCents || (a.place ?? 999) - (b.place ?? 999))

  const unassignedCents = placePoolCents - amounts.reduce((a, b) => a + b, 0)
  return {
    buyInCents,
    potCents,
    weeklyReserveCents,
    placePoolCents,
    unassignedPercent: percents.length ? 100 - assignedPercent : 100,
    unassignedCents,
    places,
    teams,
    final: input.final,
    overCommittedCents: Math.max(0, committed - potCents),
  }
}

/** A common split for a league of `teams`, offered as a starting point. */
export function suggestedPlacePercents(teams: number): number[] {
  if (teams <= 6) return [70, 30]
  if (teams <= 10) return [60, 30, 10]
  return [50, 30, 20]
}
