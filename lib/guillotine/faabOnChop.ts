/**
 * What happens to a chopped team's unspent FAAB.
 *
 *   keep          nothing — the money leaves the league with the team (what every Guilly league did
 *                 before this existed, so it stays the default)
 *   split         divided evenly among the teams still alive, the common chopped-league rule: the
 *                 survivors fight over the chopped roster with the budget the chopped team never spent
 *   top_scorer    all of it to the survivor with the week's highest score: a prize for winning the week
 *   low_scorer    all of it to the survivor with the week's lowest score: the team that just escaped the
 *                 chop gets the means to rebuild
 *   waiver_order  all of it to one survivor, taken in turn: the team first in the league's waiver order
 *                 that has been paid the fewest times. Each chop pays the next team in line, so the money
 *                 rolls through the league the way a rolling waiver order does.
 *
 * And HOW MUCH of it moves (owner's request, 2026-11-25): `percent` of each chopped team's balance is passed
 * on; the rest leaves with the team, as under `keep`. 100 is everything, the default.
 *
 * The budget the waiver engine spends is `Roster.faabRemaining` (lib/waiver-wire/process-engine.ts),
 * so that is what moves. A roster with no budget (FAAB off, so `faabRemaining` is null) is neither a
 * source nor a recipient.
 *
 * Pure, so the settings page can import it. The database write is in ./faabOnChopApply.ts.
 */
export type FaabOnChop = 'keep' | 'split' | 'top_scorer' | 'low_scorer' | 'waiver_order'

/** League.settings key. Absent = keep. */
export const FAAB_ON_CHOP_KEY = 'guillotineFaabOnChop'
/** League.settings key: the share of a chopped team's balance that is passed on. Absent = 100. */
export const FAAB_ON_CHOP_PERCENT_KEY = 'guillotineFaabOnChopPercent'
export const DEFAULT_FAAB_ON_CHOP_PERCENT = 100
/** The shares the settings page offers. Any whole number from 1 to 100 is a valid stored value. */
export const FAAB_ON_CHOP_PERCENT_CHOICES: readonly number[] = [100, 75, 50, 25]

export const FAAB_ON_CHOP_OPTIONS: ReadonlyArray<{ value: FaabOnChop; label: string; help: string }> = [
  { value: 'keep', label: 'It leaves with the team', help: "Survivors keep the budgets they have; the chopped team's leftover is gone." },
  { value: 'split', label: 'Split it among the survivors', help: "The chopped team's leftover FAAB is shared evenly by every team still alive." },
  { value: 'top_scorer', label: "To the week's highest scorer", help: "The chopped team's leftover FAAB goes to the surviving team with the week's top score. A tie shares it." },
  { value: 'low_scorer', label: "To the week's lowest surviving scorer", help: "The chopped team's leftover FAAB goes to the team that just escaped the chop. A tie shares it." },
  { value: 'waiver_order', label: 'One team at a time, in waiver order', help: "The chopped team's leftover FAAB goes to the next surviving team in waiver order. Each chop pays the next team in line." },
]

const POLICIES: ReadonlySet<string> = new Set(FAAB_ON_CHOP_OPTIONS.map((o) => o.value))

export function isFaabOnChop(value: unknown): value is FaabOnChop {
  return typeof value === 'string' && POLICIES.has(value)
}

export function readFaabOnChop(settings: unknown): FaabOnChop {
  const v = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[FAAB_ON_CHOP_KEY] : null
  return isFaabOnChop(v) ? v : 'keep'
}

/** True for every rule that moves a chopped team's FAAB to a survivor (everything but `keep`). */
export function movesChoppedFaab(policy: FaabOnChop): boolean {
  return policy !== 'keep'
}

export function isFaabOnChopPercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100
}

export function readFaabOnChopPercent(settings: unknown): number {
  const v = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[FAAB_ON_CHOP_PERCENT_KEY] : null
  return isFaabOnChopPercent(v) ? v : DEFAULT_FAAB_ON_CHOP_PERCENT
}

/** Whole dollars taken from a chopped team's balance: `percent` of it, rounded down. Never more than it has. */
export function faabTakenFromChopped(balance: number | null | undefined, percent: number): number {
  const b = Math.max(0, Math.floor(balance ?? 0))
  const p = isFaabOnChopPercent(percent) ? percent : DEFAULT_FAAB_ON_CHOP_PERCENT
  return Math.floor((b * p) / 100)
}

type FaabSplit = {
  /** Total taken from the chopped teams. */
  pool: number
  /** rosterId → amount added. Whole dollars; the remainder goes one each to the lowest balances. */
  shares: Map<string, number>
}

/**
 * Pure. Every dollar of the pool is handed out: `floor(pool / n)` each, then the leftover dollars one
 * at a time to the survivors with the least FAAB (ties by roster id, so a retry decides the same way).
 */
export function splitChoppedFaab(pool: number, survivors: ReadonlyArray<{ rosterId: string; faab: number }>): FaabSplit {
  const shares = new Map<string, number>()
  const total = Math.max(0, Math.floor(pool))
  if (total === 0 || survivors.length === 0) return { pool: 0, shares }
  const base = Math.floor(total / survivors.length)
  let leftover = total - base * survivors.length
  const neediest = [...survivors].sort((a, b) => a.faab - b.faab || a.rosterId.localeCompare(b.rosterId))
  for (const s of neediest) {
    const extra = leftover > 0 ? 1 : 0
    leftover -= extra
    shares.set(s.rosterId, base + extra)
  }
  return { pool: total, shares }
}

/** A team still alive that has a FAAB budget, with what each rule needs to place it. */
export type FaabSurvivor = {
  rosterId: string
  faab: number
  /** The score the chop ranked this team on this week. Null when unknown. */
  weekPoints?: number | null
  /** The league's waiver order: lower is earlier. Null when the league keeps none. */
  waiverPriority?: number | null
  /** Times this team has already been paid under `waiver_order` this season. */
  received?: number
}

export type FaabDistribution = FaabSplit & {
  /** The rule that actually placed the money: `split` when a scorer rule had no scores to read. */
  applied: FaabOnChop
}

/**
 * Who gets the pool under `policy`. Pure and deterministic: the same teams, scores and order always give the same
 * answer, so a retried chop pays the same team and the commissioner's preview shows what the chop will do.
 *
 *  - Every dollar of the pool is handed out, whatever the rule.
 *  - A tie for the top or the bottom score shares the pool evenly (leftover dollars as `splitChoppedFaab`).
 *  - A scorer rule with no score for any survivor falls back to an even split and says so (`applied`), rather than
 *    pick a team by nothing.
 *  - `waiver_order`: the fewest payouts so far first, then the earlier waiver priority (a team with none goes after
 *    every team with one), then the roster id.
 */
export function distributeChoppedFaab(policy: FaabOnChop, pool: number, survivors: readonly FaabSurvivor[]): FaabDistribution {
  if (policy === 'keep') return { pool: 0, shares: new Map(), applied: 'keep' }
  if (policy === 'split') return { ...splitChoppedFaab(pool, survivors), applied: 'split' }
  if (policy === 'waiver_order') {
    const line = [...survivors].sort(
      (a, b) =>
        (a.received ?? 0) - (b.received ?? 0) ||
        (a.waiverPriority ?? Number.POSITIVE_INFINITY) - (b.waiverPriority ?? Number.POSITIVE_INFINITY) ||
        a.rosterId.localeCompare(b.rosterId),
    )
    return { ...splitChoppedFaab(pool, line.slice(0, 1)), applied: 'waiver_order' }
  }
  const scored = survivors.filter((s) => typeof s.weekPoints === 'number' && Number.isFinite(s.weekPoints))
  if (scored.length === 0) return { ...splitChoppedFaab(pool, survivors), applied: 'split' }
  const points = scored.map((s) => s.weekPoints as number)
  const target = policy === 'top_scorer' ? Math.max(...points) : Math.min(...points)
  return { ...splitChoppedFaab(pool, scored.filter((s) => s.weekPoints === target)), applied: policy }
}

/** "about $40 each" / "$120" — how a payout reads once it is known who got it. */
export function describeFaabPayout(args: { applied: FaabOnChop; pool: number; recipients: readonly string[]; survivors: number; choppedCount: number }): string {
  const whose = args.choppedCount === 1 ? "The chopped team's" : "The chopped teams'"
  const money = `$${args.pool} of unspent FAAB`
  const names = args.recipients.length <= 1 ? args.recipients[0] ?? 'a surviving team' : `${args.recipients.slice(0, -1).join(', ')} and ${args.recipients[args.recipients.length - 1]}`
  const shared = args.recipients.length > 1 ? ', shared evenly' : ''
  switch (args.applied) {
    case 'top_scorer':
      return `${whose} ${money} went to ${names}${shared}, for the week's highest score.`
    case 'low_scorer':
      return `${whose} ${money} went to ${names}${shared}, the lowest score to survive the week.`
    case 'waiver_order':
      return `${whose} ${money} went to ${names}, next in waiver order.`
    default:
      return `${whose} ${money} was split among the ${args.survivors} teams still alive: about $${Math.floor(args.pool / Math.max(1, args.survivors))} each.`
  }
}

/**
 * Owner's decision, 2026-11-22: passing a chopped team's FAAB to the survivors and "FAAB after a chop" (top up /
 * reset every survivor, ./chopSchedule.ts) cannot be on together. Both move the survivors' budgets in the same
 * chop, and the reset ran after the payout, so a "set" rule silently erased it. Each save path refuses the second
 * one with this message; the chop engine also skips the reset when both are somehow on (a league saved before the
 * rule). It was written for `split`; it holds for every rule that moves the money (`movesChoppedFaab`).
 */
export const FAAB_RULES_CONFLICT_MESSAGE =
  "Passing a chopped team's FAAB to the survivors and resetting or topping up survivors' FAAB can't both be on. Turn one off first."
