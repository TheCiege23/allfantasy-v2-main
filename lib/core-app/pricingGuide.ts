/**
 * /pricing in plain words (2026-11-14). The owner's ask: every page should say what it is for and what
 * to do. Pricing opened on a slogan ("Win more with tools built for fantasy managers"), quoted yearly
 * prices twice, showed a "Save 28%" chip beside cards that said 33%, and said why AF Supreme is good
 * value three times.
 *
 * Every figure here is DERIVED from the plans the server read out of the catalog — the same rule the
 * screen's own header states. Nothing is typed in.
 *
 * Pure, so the rules are testable and PricingV4 stays a renderer.
 */
import type { PricingAccount } from './pricingAccount'

/** The fields of a priced plan these rules read — structurally PricingV4's `PricingPlan`. */
export type GuidePlan = {
  planFamily: string
  monthlyPrice: number | null
  yearlyPrice: number | null
  savings: { savedPct: number } | null
}

export type PricingHeadline =
  | { kind: 'plan'; planName: string; supreme: boolean }
  | { kind: 'free'; fromMonthly: number | null }

/**
 * What the top of the page says. A signed-in viewer on a paid plan is told the plan they are on; anyone
 * else — a visitor, a free account, a failed account read — is told the rule (every league is free) and
 * the cheapest monthly price, which is the number someone arrives here to find.
 */
export function pricingHeadline(account: PricingAccount | null, plans: ReadonlyArray<GuidePlan>): PricingHeadline {
  if (account?.planName) {
    return { kind: 'plan', planName: account.planName, supreme: account.planIds.includes('supreme') }
  }
  const monthly = plans.map((p) => p.monthlyPrice).filter((n): n is number => n != null && n > 0)
  return { kind: 'free', fromMonthly: monthly.length > 0 ? Math.min(...monthly) : null }
}

/**
 * The yearly saving as a range across the plans sold yearly — "Save 28–33%". The old chip quoted only
 * the smallest, which is true but read as a contradiction beside cards saying 33%. Null when no plan
 * saves anything yearly.
 */
export function yearlySavingsRange(plans: ReadonlyArray<GuidePlan>): { min: number; max: number } | null {
  const pcts = plans.map((p) => p.savings?.savedPct).filter((n): n is number => n != null && n > 0)
  if (pcts.length === 0) return null
  return { min: Math.min(...pcts), max: Math.max(...pcts) }
}

/**
 * AF Supreme against AF Pro + AF Commissioner bought separately, for the interval on screen. This one
 * line replaces three: a "Best value" tag, "for less than buying both", and a bullet saying "Cheaper
 * than the two subscriptions bought separately". Null unless all three are priced for that interval and
 * Supreme is genuinely cheaper — a claim the arithmetic does not back is not printed.
 */
export function supremeValue(
  plans: ReadonlyArray<GuidePlan>,
  interval: 'month' | 'year',
): { supreme: number; separately: number } | null {
  const price = (family: string) => {
    const p = plans.find((x) => x.planFamily === family)
    return p ? (interval === 'month' ? p.monthlyPrice : p.yearlyPrice) : null
  }
  const supreme = price('af_supreme')
  const pro = price('af_pro')
  const commissioner = price('af_commissioner')
  if (supreme == null || pro == null || commissioner == null) return null
  const separately = Math.round((pro + commissioner) * 100) / 100
  return supreme < separately ? { supreme, separately } : null
}

/**
 * The plan-card bullet that `supremeValue` now says with numbers. Shared with other purchase surfaces
 * (lib/monetization/planIncludes.ts), so it is dropped here rather than edited there.
 */
export const SUPREME_VALUE_BULLET = 'Cheaper than the two subscriptions bought separately'

type Cell = { kind: string }
type Row = { id: string; label: string; cells: Record<string, Cell> }
type Group<R extends Row> = { id: string; title: string; rows: R[] }

/**
 * Pulls rows that are "Coming soon" on EVERY plan out of the comparison table. A row with no tick in any
 * column compares nothing; they become one line under the table instead of four rows of badges.
 */
export function splitComingSoon<R extends Row, G extends Group<R>>(groups: ReadonlyArray<G>): { groups: G[]; soon: R[] } {
  const soon: R[] = []
  const kept: G[] = []
  for (const g of groups) {
    const rows = g.rows.filter((r) => {
      const cells = Object.values(r.cells)
      const allSoon = cells.length > 0 && cells.every((c) => c.kind === 'soon')
      if (allSoon) soon.push(r)
      return !allSoon
    })
    if (rows.length > 0) kept.push({ ...g, rows })
  }
  return { groups: kept, soon }
}
