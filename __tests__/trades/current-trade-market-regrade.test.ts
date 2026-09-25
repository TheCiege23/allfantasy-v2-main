/**
 * The "Now" regrade of a native trade is THE grade (2026-09-25): the one grader, from the proposer's
 * side, on today's league values, with no roster need. The pre-2026-09-25 version fetched its own
 * book and graded the gap against what was given; these keep the behaviours that outlived it — one
 * book per call, a consumed pick withheld — and pin the new one.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { priceTradesAtCurrentMarket } from '@/lib/league-trade-engine/tradeLearningCapture'
import type { LeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'
import { gradeTrade } from '@/lib/decision-os/trade/tradeGrade'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'

const PRICES: Record<string, number> = { 'Player One': 1000, 'Player Two': 1500 }

function fakeGrader(calls: Array<{ give: TradeAssetInput[]; get: TradeAssetInput[]; viewerSide: boolean }>): LeagueTradeGrader {
  const total = (xs: TradeAssetInput[]) => xs.reduce((s, x) => s + (x.kind === 'player' ? PRICES[x.name ?? ''] ?? 0 : 0), 0)
  return {
    leagueId: 'league-1',
    chart: {} as LeagueTradeGrader['chart'],
    grade: async (args) => {
      calls.push(args)
      const giveValue = total(args.give)
      const getValue = total(args.get)
      return gradeTrade({
        giveValue,
        getValue,
        giveMarket: giveValue,
        getMarket: getValue,
        unpriced: 0,
        giveCount: args.give.length,
        getCount: args.get.length,
        basis: 'Dynasty · 1QB · 12 teams · PPR',
        scoringApplied: false,
        needApplied: false,
        needGap: null,
        lines: [],
        moves: [],
      })
    },
  }
}

const names = async () => (id: string) => ({ p1: 'Player One', p2: 'Player Two' } as Record<string, string>)[id] ?? null
const league = { leagueType: 'dynasty', leagueVariant: 'standard', isDynasty: true, scoring: 'PPR', settings: {} } as never

describe('historical trade "Now" regrade is the one grade', () => {
  it('grades from the proposer’s side on league value, with no roster need', async () => {
    const calls: Parameters<LeagueTradeGrader['grade']>[0][] = []
    const result = await priceTradesAtCurrentMarket(
      {
        leagueId: 'league-1',
        league,
        trades: [{
          id: 'trade-1',
          proposerRosterId: 'roster-a',
          items: [
            { itemType: 'player', itemReference: 'p1', fromRosterId: 'roster-a', toRosterId: 'roster-b' },
            { itemType: 'player', itemReference: 'p2', fromRosterId: 'roster-b', toRosterId: 'roster-a' },
          ],
        }],
      },
      { createGrader: async () => fakeGrader(calls), loadNames: names },
    )

    // 1000 out, 1500 in: +33% of the larger side — an A, the Trade Center's letter for the same deal.
    expect(result.get('trade-1')).toMatchObject({ grade: 'A', valueGiven: 1000, valueReceived: 1500, fullyPriced: true, unresolvedAssets: [] })
    expect(calls[0]).toEqual({
      give: [{ kind: 'player', name: 'Player One' }],
      get: [{ kind: 'player', name: 'Player Two' }],
      viewerSide: false,
    })
  })

  it('withholds a grade for a consumed pick instead of valuing it as an unspent pick', async () => {
    const calls: Parameters<LeagueTradeGrader['grade']>[0][] = []
    const result = await priceTradesAtCurrentMarket(
      {
        leagueId: 'league-1',
        league,
        trades: [{
          id: 'trade-old-pick',
          proposerRosterId: 'roster-a',
          items: [
            { itemType: 'rookie_pick', itemReference: 'old-1', fromRosterId: 'roster-a', toRosterId: 'roster-b', metadata: { season: 2024, round: 1 } },
            { itemType: 'player', itemReference: 'p2', fromRosterId: 'roster-b', toRosterId: 'roster-a' },
          ],
        }],
      },
      { createGrader: async () => fakeGrader(calls), loadNames: names },
    )

    expect(result.get('trade-old-pick')).toMatchObject({
      grade: null,
      valueGiven: null,
      valueReceived: null,
      fullyPriced: false,
      unresolvedAssets: ['2024 draft pick'],
    })
    expect(calls).toHaveLength(0)
  })

  it('loads one grader for multiple history rows', async () => {
    const created = vi.fn(async () => fakeGrader([]))
    const trade = (id: string) => ({
      id,
      proposerRosterId: 'roster-a',
      items: [
        { itemType: 'player', itemReference: 'p1', fromRosterId: 'roster-a', toRosterId: 'roster-b' },
        { itemType: 'player', itemReference: 'p2', fromRosterId: 'roster-b', toRosterId: 'roster-a' },
      ],
    })
    const result = await priceTradesAtCurrentMarket(
      { leagueId: 'league-1', league, trades: [trade('one'), trade('two')] },
      { createGrader: created, loadNames: names },
    )

    expect(result.size).toBe(2)
    expect(created).toHaveBeenCalledTimes(1)
  })

  it('an unreadable league withholds every row rather than inventing a letter', async () => {
    const result = await priceTradesAtCurrentMarket(
      {
        leagueId: 'league-1',
        league,
        trades: [{
          id: 'trade-1',
          proposerRosterId: 'roster-a',
          items: [
            { itemType: 'player', itemReference: 'p1', fromRosterId: 'roster-a', toRosterId: 'roster-b' },
            { itemType: 'player', itemReference: 'p2', fromRosterId: 'roster-b', toRosterId: 'roster-a' },
          ],
        }],
      },
      { createGrader: async () => null, loadNames: names },
    )
    expect(result.get('trade-1')).toMatchObject({ grade: null, fullyPriced: false })
  })
})
