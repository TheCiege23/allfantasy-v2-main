/**
 * Completed trades and receipts carry THE grade (2026-09-25). These pin the pure pieces that put it
 * there: the pre-points letter rebased onto the one grade, the exact mirror letter, the breakdown
 * read off the grade's own lines, and archived rows priced from their own side.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { gradeTrade, mirrorLetter, type TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import { oneGradeBreakdown } from '@/lib/decision-os/trade/tradeGradeBreakdown'
import { gradeArchivedTrade } from '@/lib/decision-os/trade/completedTradeGrade'
import type { LeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'
import { withOneGrade, type TradeExpectation } from '@/lib/trade-intel/tradeExpectation'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'

const graded = (give: number, get: number, lines: Extract<TradeGradeView, { graded: true }>['lines'] = []) => {
  const g = gradeTrade({
    giveValue: give, getValue: get, giveMarket: give, getMarket: get, unpriced: 0, giveCount: 1, getCount: 1,
    basis: 'Dynasty · 1QB · 12 teams · PPR', scoringApplied: false, needApplied: false, needGap: null, lines, moves: [],
  })
  if (!g.graded) throw new Error('expected a grade')
  return g
}

describe('mirrorLetter is exactly the swapped deal', () => {
  it('matches grading the swapped deal across every band', () => {
    for (let get = 400; get <= 2500; get += 7) {
      expect(mirrorLetter(graded(1000, get).letter)).toBe(graded(get, 1000).letter)
    }
    expect(mirrorLetter(null)).toBeNull()
  })
})

describe('withOneGrade — the letter before points arrive is THE grade', () => {
  const side = (rosterId: number, letter: 'A' | 'B' | 'C' | 'D' | 'F') => ({
    rosterId,
    managerName: `m${rosterId}`,
    assetsIn: [{ key: `in${rosterId}`, name: `In ${rosterId}`, position: 'WR', isPick: false, marketValue: 1, valueStdDev: null, valueSpread: null }],
    assetsOut: [{ key: `out${rosterId}`, name: `Out ${rosterId}`, position: 'RB', isPick: false, marketValue: 1, valueStdDev: null, valueSpread: null }],
    marketIn: 1,
    marketOut: 1,
    marketNet: 0,
    projected: { letter, valueEdge: 0.05, valueNet: 1, uncertainty: 40, insideNoise: true, productionDisagrees: false, confidence: 'low' as const },
  })
  const expectation = (scope: 'market-only' | 'withheld-specialty' = 'market-only', sides = [side(1, 'C'), side(2, 'C')]) =>
    ({ available: true, leagueNote: 'x', priorSeason: null, scoringMode: null, sides, missing: [], evaluation: { scope } } as unknown as TradeExpectation)

  it('rebases the letters, the edge and the totals onto the grade — and side two is the mirror', () => {
    const g = graded(1000, 1500, [
      { side: 'give', name: 'Out 1', marketValue: 1000, leagueValue: 1000 },
      { side: 'get', name: 'In 1', marketValue: 1500, leagueValue: 1500 },
    ])
    const out = withOneGrade(expectation(), g)
    const [a, b] = out.sides as Array<(typeof out.sides)[number] & Record<string, unknown>>
    // The old rule forced a C inside the noise band; the one grade says A — and says it everywhere.
    expect(a!.projected).toMatchObject({ letter: 'A', valueEdge: 0.33, valueNet: 500, insideNoise: true })
    expect(b!.projected).toMatchObject({ letter: 'F', valueEdge: -0.33, valueNet: -500 })
    expect([a!.marketIn, a!.marketOut, b!.marketIn, b!.marketOut]).toEqual([1500, 1000, 1000, 1500])
    expect(a!.assetsIn[0]!.marketValue).toBe(1500)
    expect(a!.assetsOut[0]!.marketValue).toBe(1000)
  })

  it('a withheld grade withholds the letter, and says why — it never falls back to the old rule', () => {
    const out = withOneGrade(expectation(), { graded: false, reason: 'In 1 has no value on this league’s chart.', basis: null })
    expect(out.sides.map((s) => s.projected)).toEqual([null, null])
    expect(out.missing).toContain('grade withheld: In 1 has no value on this league’s chart.')
  })

  it('a three-team trade gets no letter, as the one grade gives none', () => {
    const out = withOneGrade(expectation('market-only', [side(1, 'B'), side(2, 'C'), side(3, 'D')]), graded(1000, 1500))
    expect(out.sides.map((s) => s.projected)).toEqual([null, null, null])
  })

  it('never overrides a specialty/historical withholding', () => {
    const exp = expectation('withheld-specialty')
    expect(withOneGrade(exp, graded(1000, 1500))).toBe(exp)
  })
})

describe('oneGradeBreakdown reads only the grade', () => {
  it('headlines the letter with the grade’s own totals and names the best asset', () => {
    const g = graded(3000, 9000, [
      { side: 'give', name: 'Beta Wide', marketValue: 3000, leagueValue: 3000 },
      { side: 'get', name: 'Alpha Back', marketValue: 9000, leagueValue: 9000 },
    ])
    const out = oneGradeBreakdown({ grade: g, receiverLabel: 'You', partnerLabel: 'Gridiron Vultures' })
    expect(out[0]).toBe('You came out well ahead — 9,000 in league value for 3,000.')
    expect(out[1]).toBe('The most valuable asset was Alpha Back, and You got him.')
    expect(out.at(-1)).toContain('Dynasty · 1QB · 12 teams · PPR')
  })

  it('says when quality and quantity pulled apart', () => {
    const g = graded(1000, 1400, [
      { side: 'give', name: 'Star', marketValue: 1000, leagueValue: 1000 },
      { side: 'get', name: 'Depth One', marketValue: 700, leagueValue: 700 },
      { side: 'get', name: 'Depth Two', marketValue: 700, leagueValue: 700 },
    ])
    expect(oneGradeBreakdown({ grade: g, receiverLabel: 'You', partnerLabel: 'Them' })[1]).toMatch(/^Quality and quantity pulled apart: the best single asset was Star, and Them got him/)
  })
})

describe('gradeArchivedTrade — a row graded from its own side', () => {
  const recorder = () => {
    const calls: Array<{ give: TradeAssetInput[]; get: TradeAssetInput[]; viewerSide: boolean }> = []
    const grader = {
      leagueId: 'L',
      chart: {} as LeagueTradeGrader['chart'],
      grade: async (args: (typeof calls)[number]) => {
        calls.push(args)
        return graded(1000, 1000)
      },
    } as LeagueTradeGrader
    return { calls, grader }
  }

  it('gives what the row gave and gets what it received, without roster need', async () => {
    const { calls, grader } = recorder()
    await gradeArchivedTrade(grader, {
      received: ['Alpha Back'], gave: ['Beta Wide'],
      picksIn: [{ season: '2027', round: 1, label: '2027 1st' }], picksOut: [],
      currentSeason: 2026,
    })
    expect(calls[0]).toEqual({
      give: [{ kind: 'player', name: 'Beta Wide' }],
      get: [{ kind: 'player', name: 'Alpha Back' }, { kind: 'pick', year: 2027, round: 1 }],
      viewerSide: false,
    })
  })

  it('a used pick or an unnamed player withholds the letter, named — never priced as zero', async () => {
    const { calls, grader } = recorder()
    const g = await gradeArchivedTrade(grader, {
      received: [null], gave: ['Beta Wide'],
      picksIn: [], picksOut: [{ season: '2024', round: 2, label: '2024 2nd' }],
      currentSeason: 2026,
    })
    expect(g).toMatchObject({ graded: false, reason: expect.stringMatching(/^2024 2nd, a player with no name on file cannot be priced/) })
    expect(calls).toHaveLength(0)
  })
})
