import { describe, expect, it, vi } from 'vitest'
import { evaluateCounterOffers } from '@/lib/trade-value-console/counterOffers'
import { gradeTrade } from '@/lib/decision-os/trade/tradeGrade'

const grade = (give: number, get: number) => gradeTrade({ giveValue: give, getValue: get,
  giveMarket: give, getMarket: get, unpriced: 0, giveCount: 1, getCount: 1,
  basis: 'League test', scoringApplied: false, needApplied: false, needGap: null, lines: [], moves: [] })
const target = (name: string, marketValue: number) => ({ id: name, name, position: 'WR', marketValue })

describe('counteroffer package evaluation', () => {
  it('excludes a value-balanced package when affordability fails or cannot be verified', async () => {
    const evaluate = vi.fn(async () => grade(1000, 1000))
    const canRecommend = vi.fn(async (_give, get) => get.at(-1)?.name === 'Affordable')
    const offers = await evaluateCounterOffers({ grade: grade(1000, 700), give: [{ kind: 'player', name: 'Given' }],
      get: [{ kind: 'player', name: 'Received' }], yourTargets: [],
      theirTargets: [target('Unaffordable', 300), target('Affordable', 310)], evaluate, canRecommend })
    expect(offers.map(o => o.name)).toEqual(['Affordable'])
    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(canRecommend).toHaveBeenCalledTimes(2)
  })
  it('uses the recalculated league grade rather than promising equality from the shortlist price', async () => {
    const evaluate = vi.fn(async (_give, get) => grade(1000, get.at(-1)?.name === 'Depth' ? 960 : 1400))
    const offers = await evaluateCounterOffers({ grade: grade(1000, 700), give: [{ kind: 'player', name: 'Given' }],
      get: [{ kind: 'player', name: 'Received' }], yourTargets: [],
      theirTargets: [target('Depth', 300), target('Too much', 400), target('Unpriced', 0)], evaluate })
    expect(offers).toHaveLength(1)
    expect(offers[0]).toMatchObject({ name: 'Depth', addTo: 'get', remainingGap: 40, balanced: true })
    expect(evaluate).toHaveBeenCalledTimes(2)
  })
  it('adds from your roster when the existing deal favors you', async () => {
    const offers = await evaluateCounterOffers({ grade: grade(700, 1000), give: [{ kind: 'player', name: 'Given' }],
      get: [{ kind: 'player', name: 'Received' }], yourTargets: [target('Bench', 300)], theirTargets: [],
      evaluate: async (give, get) => { expect(give).toHaveLength(2); expect(get).toHaveLength(1); return grade(1000, 1000) } })
    expect(offers[0]).toMatchObject({ addTo: 'give', rosterPlayerId: 'Bench', remainingGap: 0 })
  })
  it('excludes selected assets, duplicates and unresolved candidates', async () => {
    const evaluate = vi.fn(async () => ({ graded: false as const, reason: 'Missing', basis: null }))
    const offers = await evaluateCounterOffers({ grade: grade(1000, 700), give: [{ kind: 'player', name: 'Given' }],
      get: [{ kind: 'player', name: 'Received' }], yourTargets: [],
      theirTargets: [target('Received', 300), target('Missing', 300), target('Missing', 300)], evaluate })
    expect(offers).toEqual([])
    expect(evaluate).toHaveBeenCalledTimes(1)
  })
  it('does not evaluate even or withheld trades', async () => {
    const evaluate = vi.fn()
    for (const current of [grade(1000, 1000), { graded: false as const, reason: 'Missing', basis: null }]) {
      expect(await evaluateCounterOffers({ grade: current, give: [], get: [], yourTargets: [], theirTargets: [target('Extra', 50)], evaluate })).toEqual([])
    }
    expect(evaluate).not.toHaveBeenCalled()
  })
})
