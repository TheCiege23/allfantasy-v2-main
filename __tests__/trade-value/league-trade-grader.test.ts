/**
 * The one grader, end to end with the data layer stubbed: league → chart → price → grade.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  prices: new Map<string, number>(),
  chart: [] as Array<{ player: { name: string; position: string }; value: number }>,
  needCalls: 0,
  pricePickCalls: 0,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/trade-value-console/league-loader', () => ({
  loadLeagueForTrade: async () => ({
    id: 'L1',
    platformLeagueId: null,
    name: 'Dynasty for life',
    sport: 'NFL',
    leagueSize: 12,
    isDynasty: true,
    leagueType: 'dynasty',
    scoring: 'ppr',
    settings: { scoring_settings: { rec: 1 }, roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN'] },
    waiverBudget: 100,
    taxiSlots: 0,
    leagueVariant: 'dynasty',
    bestBallMode: false,
    starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'],
  }),
}))
vi.mock('@/lib/league-context-engine', () => ({ resolveNormalizedLeagueContext: async () => ({ ok: false }) }))
vi.mock('@/lib/fantasycalc-db', () => ({ getFantasyCalcValuesDbFirst: async () => h.chart }))
vi.mock('@/lib/league-values/leagueTradeValues', () => ({ loadLeagueTradeValues: async () => null }))
vi.mock('@/lib/data/players', () => ({ getPlayer: async () => null, searchPlayers: async () => [] }))
vi.mock('@/lib/shared-services/player-identity/PlayerIdentityResolver', () => ({ resolvePlayer: async () => ({ confidence: 'none' }) }))
vi.mock('@/lib/trade-value/viewerNeedFactors', () => ({
  loadViewerNeedFactors: async (a: { give: unknown[]; get: unknown[] }) => {
    h.needCalls += 1
    return { give: a.give.map(() => null), get: a.get.map(() => null), gap: null }
  },
}))
vi.mock('@/lib/hybrid-valuation', () => {
  const asset = (name: string, mv: number, extra: Record<string, unknown> = {}) => ({
    name,
    type: 'player',
    value: mv,
    assetValue: { marketValue: mv, impactValue: Math.round(mv * 0.5), vorpValue: 50, volatility: 0.1 },
    source: 'fantasycalc',
    position: 'WR',
    ...extra,
  })
  return {
    compositeScore: (v: { marketValue: number }) => v.marketValue,
    pricePlayer: async (name: string) => {
      const mv = h.prices.get(name)
      return mv == null ? { ...asset(name, 0), unpriced: true, source: 'unknown' } : asset(name, mv)
    },
    // The historical pick file: deliberately a different number from the live chart below.
    pricePick: async (p: { year: number; round: number }) => {
      h.pricePickCalls += 1
      return asset(`${p.year} Round ${p.round}`, 999, { type: 'pick', position: 'PICK', source: 'excel' })
    },
  }
})

import { createLeagueTradeGrader, gradeDeal } from '@/lib/decision-os/trade/leagueTradeGrader'

beforeEach(() => {
  h.prices = new Map([
    ['Puka Nacua', 6000],
    ['Drake London', 4000],
    ['Jaxon Smith-Njigba', 5000],
  ])
  h.chart = [
    { player: { name: '2027 Pick 1.01', position: 'PICK' }, value: 3000 },
    { player: { name: '2027 Pick 1.12', position: 'PICK' }, value: 1000 },
    { player: { name: '2027 Round 2', position: 'PICK' }, value: 700 },
  ]
  h.needCalls = 0
  h.pricePickCalls = 0
})

const graded = <T extends { graded: boolean }>(v: T) => {
  if (!v.graded) throw new Error(`withheld: ${JSON.stringify(v)}`)
  return v as Extract<T, { graded: true }>
}

describe('createLeagueTradeGrader', () => {
  it('grades a 1.5x deal A for the receiver and F for the sender, on the league chart', async () => {
    const g = (await createLeagueTradeGrader({ leagueId: 'L1', userId: 'u' }))!
    const v = graded(
      await g.grade({ give: [{ kind: 'player', name: 'Drake London' }], get: [{ kind: 'player', name: 'Puka Nacua' }], viewerSide: true }),
    )
    expect([v.letter, v.partnerLetter]).toEqual(['A', 'F'])
    expect([v.giveValue, v.getValue]).toEqual([4000, 6000])
    expect(v.basis).toBe('Dynasty · 1QB · 12 teams · PPR')
    expect(v.lines.map((l) => [l.side, l.name, l.leagueValue])).toEqual([
      ['give', 'Drake London', 4000],
      ['get', 'Puka Nacua', 6000],
    ])
  })

  it('roster need is priced only when the graded side is the viewer', async () => {
    const g = (await createLeagueTradeGrader({ leagueId: 'L1', userId: 'u' }))!
    const deal = { give: [{ kind: 'player' as const, name: 'Drake London' }], get: [{ kind: 'player' as const, name: 'Puka Nacua' }] }
    await g.grade({ ...deal, viewerSide: false })
    expect(h.needCalls).toBe(0)
    await g.grade({ ...deal, viewerSide: true })
    expect(h.needCalls).toBe(1)
  })

  it('🛑 a pick is priced off the LIVE chart, not the February pick file', async () => {
    const g = (await createLeagueTradeGrader({ leagueId: 'L1', userId: 'u' }))!
    const v = graded(
      await g.grade({ give: [{ kind: 'pick', year: 2027, round: 1 }], get: [{ kind: 'player', name: 'Drake London' }], viewerSide: false }),
    )
    // Round average of the chart's own 2027 1st rows — 3000 and 1000 — never the file's 999.
    expect(v.giveValue).toBe(2000)
    expect(h.pricePickCalls).toBe(1) // still asked, for the pick's shape; its price is replaced
  })

  it('a pick the chart does not carry falls back to the old pricer, as before', async () => {
    const g = (await createLeagueTradeGrader({ leagueId: 'L1', userId: 'u' }))!
    const v = graded(
      await g.grade({ give: [{ kind: 'pick', year: 2029, round: 3 }], get: [{ kind: 'player', name: 'Drake London' }], viewerSide: false }),
    )
    expect(v.giveValue).toBe(999)
  })

  it('an unpriced player withholds the letter rather than grading him as worthless', async () => {
    const g = (await createLeagueTradeGrader({ leagueId: 'L1', userId: 'u' }))!
    const v = await g.grade({
      give: [{ kind: 'player', name: 'Nobody McUnknown' }],
      get: [{ kind: 'player', name: 'Puka Nacua' }],
      viewerSide: false,
    })
    expect(v.graded).toBe(false)
  })
})

describe('gradeDeal', () => {
  it('a league that could not be read is withheld, not graded', async () => {
    const v = await gradeDeal(null, { give: { assets: [], unpriceable: [] }, get: { assets: [], unpriceable: [] }, viewerSide: true })
    expect(v).toMatchObject({ graded: false, reason: expect.stringMatching(/could not be loaded/) })
  })

  it('an asset that cannot be priced withholds before anything is priced', async () => {
    const g = (await createLeagueTradeGrader({ leagueId: 'L1', userId: 'u' }))!
    const v = await gradeDeal(g, {
      give: { assets: [{ kind: 'player', name: 'Drake London' }], unpriceable: [] },
      get: { assets: [], unpriceable: ['Future pick'] },
      viewerSide: true,
    })
    expect(v).toMatchObject({ graded: false, reason: expect.stringMatching(/^Future pick cannot be priced/) })
  })
})
