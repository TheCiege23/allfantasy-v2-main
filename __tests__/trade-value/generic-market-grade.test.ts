import { describe, expect, it } from 'vitest'
import type { PricedAsset } from '@/lib/hybrid-valuation'
import type { TradeConsolePlayerLine } from '@/lib/trade-value-console/types'
import type { LeagueTradeChart } from '@/lib/trade-value-console/leagueTradePricing'
import { gradePricedSides } from '@/lib/decision-os/trade/leagueTradeGrader'

const line = (name: string, value: number): TradeConsolePlayerLine => ({
  name, playerId: null, sport: 'NFL', position: 'QB', team: 'X', headshotUrl: null,
  logoUrl: null, injuryStatus: null, dataSource: 'fantasycalc', composite: 0,
  marketValue: value, pricedSource: 'fantasycalc',
})
const priced = (name: string, value: number): PricedAsset => ({
  name, type: 'player', value, position: 'QB', source: 'fantasycalc',
  assetValue: { marketValue: value, impactValue: value, vorpValue: 0, volatility: 0 },
} as PricedAsset)

const chart = {
  marketCtx: null, chartIsDynasty: false, isSuperFlex: false, leagueSize: 12,
  pprNfl: 1, valuationGaps: [], proposalRules: undefined,
} as LeagueTradeChart

describe('generic market trade grade', () => {
  it('grades a league-free comparison on market values when explicitly requested', async () => {
    const input = {
      chart, giveLines: [line('Player A', 4000)], getLines: [line('Player B', 5000)],
      givePriced: [priced('Player A', 4000)], getPriced: [priced('Player B', 5000)], need: null,
    }
    const generic = await gradePricedSides({ ...input, allowGenericMarketGrade: true })
    expect(generic.grade.graded).toBe(true)
    if (generic.grade.graded) {
      expect(generic.grade.giveMarket).toBe(4000)
      expect(generic.grade.getMarket).toBe(5000)
      expect(generic.grade.basis).toContain('no league selected')
    }

    const leagueContextMissing = await gradePricedSides(input)
    expect(leagueContextMissing.grade.graded).toBe(false)
  })
})
