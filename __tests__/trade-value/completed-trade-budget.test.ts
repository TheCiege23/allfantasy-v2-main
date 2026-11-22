import { describe, expect, it, vi } from 'vitest'

/**
 * Waiver budget (FAAB) moved in a completed trade is PRICED on the league's own budget — Fantrax's export carries
 * "Budget Amount: $5000.00" lines, Sleeper a transaction's waiver_budget. When the league's budget is not on file
 * the letter is withheld: $5000 read against the $100 stand-in is "a whole budget", a confident wrong grade.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { BUDGET_UNPRICED_REASON, archivedTradeInputs, gradeArchivedTrade } from '@/lib/decision-os/trade/completedTradeGrade'
import { archivedRowFaab } from '@/lib/core-app/archivedTradeGrade'
import type { LeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'

const grader = (waiverBudgetFromLeague: boolean | undefined) => {
  const grade = vi.fn(async () => ({ graded: false as const, reason: 'graded by the chart', basis: null }))
  return { g: { grade, pirateLeague: false, leagueType: null, chart: { waiverBudgetFromLeague } } as unknown as LeagueTradeGrader, grade }
}

// "2 picks + $5000 for a player", from the side that got the picks and the budget.
const ARGS = {
  received: [],
  gave: [{ name: 'Quarterback One', position: 'QB' }],
  picksIn: [{ season: 2027, round: 1, label: '2027 round 1' }, { season: 2028, round: 4, label: '2028 round 4' }],
  picksOut: [],
  currentSeason: 2026,
}

describe('budget money in a completed trade', () => {
  it('is priced on the side that received it, after players and picks', async () => {
    const { g, grade } = grader(true)
    await gradeArchivedTrade(g, { ...ARGS, faab: { received: 5000, gave: 0 } })
    expect(grade).toHaveBeenCalledTimes(1)
    const { give, get } = grade.mock.calls[0][0] as unknown as { give: unknown[]; get: unknown[] }
    expect(get.at(-1)).toEqual({ kind: 'faab', amount: 5000 })
    expect(give.some((a) => (a as { kind?: string }).kind === 'faab')).toBe(false)
  })

  it("withholds the letter when the league's own budget is not on file", async () => {
    for (const known of [false, undefined]) {
      const { g, grade } = grader(known)
      const view = await gradeArchivedTrade(g, { ...ARGS, faab: { received: 5000, gave: 0 } })
      expect(view).toMatchObject({ graded: false, reason: BUDGET_UNPRICED_REASON })
      expect(grade).not.toHaveBeenCalled()
    }
  })

  it('no budget moved (0 both ways, or never read) grades as before, budget on file or not', async () => {
    for (const faab of [{ received: 0, gave: 0 }, null, undefined]) {
      const { g, grade } = grader(false)
      await gradeArchivedTrade(g, { ...ARGS, faab })
      expect(grade).toHaveBeenCalledTimes(1)
      const { get } = grade.mock.calls[0][0] as unknown as { get: Array<{ kind?: string }> }
      expect(get.some((a) => a.kind === 'faab')).toBe(false)
    }
  })

  it('the re-price inputs carry it both today and at the time of the trade', () => {
    const r = archivedTradeInputs({ ...ARGS, faab: { received: 0, gave: 25 } })
    expect(r.today.give.assets.at(-1)).toEqual({ kind: 'faab', amount: 25 })
    expect(r.atTradeTime.give.assets.at(-1)).toEqual({ kind: 'faab', amount: 25 })
    expect(r.today.get.assets.some((a) => (a as { kind?: string }).kind === 'faab')).toBe(false)
  })
})

describe('archivedRowFaab', () => {
  it('null on both columns is "never read"; one read side counts the other as 0', () => {
    expect(archivedRowFaab({ budgetGiven: null, budgetReceived: null })).toBeNull()
    expect(archivedRowFaab({})).toBeNull()
    expect(archivedRowFaab({ budgetGiven: 0, budgetReceived: 5000 })).toEqual({ received: 5000, gave: 0 })
    expect(archivedRowFaab({ budgetReceived: 12 })).toEqual({ received: 12, gave: 0 })
  })
})
