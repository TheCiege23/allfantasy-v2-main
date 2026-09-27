import { describe, expect, it, vi } from 'vitest'
import { availableRosterTargets, evaluateCounterOffers } from '@/lib/trade-value-console/counterOffers'
import { gradeTrade } from '@/lib/decision-os/trade/tradeGrade'

const grade = (give: number, get: number) => gradeTrade({ giveValue: give, getValue: get,
  giveMarket: give, getMarket: get, unpriced: 0, giveCount: 1, getCount: 1,
  basis: 'League test', scoringApplied: false, needApplied: false, needGap: null, lines: [], moves: [] })
const target = (name: string, marketValue: number) => ({ id: name, name, position: 'WR', marketValue })

describe('counteroffer package evaluation', () => {
  it('excludes both the selected Yahoo identity and its verified Sleeper alias without conflating equal numeric IDs', () => {
    const targets = [
      { id: 'selected-yahoo', name: 'Same Name', position: 'LB', marketValue: 300, providerIdentity: { provider: 'yahoo' as const, id: '42' } },
      { id: 'same-canonical', name: 'Same Name', position: 'LB', marketValue: 300, providerIdentity: { provider: 'sleeper' as const, id: '999' } },
      { id: 'distinct-sleeper', name: 'Same Name', position: 'DB', marketValue: 300, providerIdentity: { provider: 'sleeper' as const, id: '42' } },
    ]
    expect(availableRosterTargets({ targets,
      selected: [{ kind: 'player', name: 'Same Name', providerIdentity: { provider: 'yahoo', id: '42' } }],
      selectedProviderIds: [{ provider: 'sleeper', id: '999' }],
    }).map(t => t.id)).toEqual(['distinct-sleeper'])
  })
  it('keeps the visible target list free of selected players without dropping distinct same-name players', () => {
    const targets = ['42', '43', '44'].map(id => ({ id, name: 'Same Name', position: 'LB', marketValue: id === '44' ? 0 : 300,
      providerIdentity: { provider: 'sleeper' as const, id } }))
    expect(availableRosterTargets({ targets: [...targets, targets[1]],
      selected: [{ kind: 'player', name: 'Same Name', playerId: 'NFL:42' }],
      selectedProviderIds: [{ provider: 'sleeper', id: '42' }],
    }).map(t => t.id)).toEqual(['43'])
    expect(availableRosterTargets({ targets, selected: [{ kind: 'player', name: 'Same Name' }] })).toEqual([])
  })
  it('excludes an already selected canonical player across record and provider namespaces', async () => {
    const evaluate = vi.fn(async () => grade(1000, 980))
    const offers = await evaluateCounterOffers({ grade: grade(1000, 700),
      give: [{ kind: 'player', name: 'Given' }],
      get: [{ kind: 'player', name: 'Same Name', playerId: 'NFL:42' }],
      selectedProviderIds: [null, { provider: 'sleeper', id: '42' }], yourTargets: [],
      theirTargets: ['42', '43'].map(id => ({ id, name: 'Same Name', position: 'LB', marketValue: 300,
        providerIdentity: { provider: 'sleeper' as const, id } })), evaluate })
    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(offers.map(o => o.rosterPlayerId)).toEqual(['43'])
  })
  it('retains verified IDs for same-name roster candidates and reads the added line value', async () => {
    const current = grade(1000, 700)
    const evaluate = vi.fn(async (_give, get) => {
      expect(get.at(-1)).toMatchObject({ providerIdentity: { provider: 'sleeper', id: 'lb', position: 'LB' } })
      return { ...grade(1000, 980), lines: [
        { side: 'get' as const, name: 'Same Name', leagueValue: 700 },
        { side: 'get' as const, name: 'Same Name', leagueValue: 280 },
      ] } as ReturnType<typeof grade>
    })
    const offers = await evaluateCounterOffers({ grade: current,
      give: [{ kind: 'player', name: 'Given' }],
      get: [{ kind: 'player', name: 'Same Name', providerIdentity: { provider: 'sleeper', id: 'wr', position: 'WR' } }],
      yourTargets: [], theirTargets: [{ id: 'lb', name: 'Same Name', position: 'LB', marketValue: 300,
        providerIdentity: { provider: 'sleeper', id: 'lb', position: 'LB' } }], evaluate })
    expect(offers).toHaveLength(1)
    expect(offers[0].assetLeagueValue).toBe(280)
  })
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
