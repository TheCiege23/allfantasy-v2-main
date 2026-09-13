import { beforeEach, describe, expect, it, vi } from 'vitest'

const rosterCount = vi.fn()
const currentBook = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: { roster: { count: (...args: unknown[]) => rosterCount(...args) } },
}))
vi.mock('@/lib/fantasycalc-db', () => ({
  getFantasyCalcValuesDbFirst: (...args: unknown[]) => currentBook(...args),
}))
vi.mock('@/lib/fantasycalc', () => ({
  findPlayerBySleeperId: (players: Array<{ sleeperId: string }>, id: string) => players.find((player) => player.sleeperId === id) ?? null,
  getPickValue: () => 500,
}))

import { priceTradesAtCurrentMarket } from '@/lib/league-trade-engine/tradeLearningCapture'

const league = {
  leagueType: 'dynasty',
  leagueVariant: 'standard',
  isDynasty: true,
  scoring: 'PPR',
  settings: { rosterSettings: { starterSlots: { QB: 1 } } },
} as never

describe('historical trade current-market regrade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rosterCount.mockResolvedValue(12)
    currentBook.mockResolvedValue([
      { sleeperId: 'p1', player: { name: 'Player One' }, value: 1000 },
      { sleeperId: 'p2', player: { name: 'Player Two' }, value: 1500 },
    ])
  })

  it('grades resolvable assets from the current market book', async () => {
    const result = await priceTradesAtCurrentMarket({
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
    })

    expect(result.get('trade-1')).toMatchObject({
      grade: 'A',
      valueGiven: 1000,
      valueReceived: 1500,
      fullyPriced: true,
      unresolvedAssets: [],
    })
    expect(currentBook).toHaveBeenCalledTimes(1)
  })

  it('withholds a grade for a consumed pick instead of valuing it as an unspent pick', async () => {
    const result = await priceTradesAtCurrentMarket({
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
    })

    expect(result.get('trade-old-pick')).toMatchObject({
      grade: null,
      valueGiven: null,
      valueReceived: null,
      fullyPriced: false,
      unresolvedAssets: ['2024 draft pick'],
    })
  })

  it('loads one value book for multiple history rows', async () => {
    const trade = (id: string) => ({
      id,
      proposerRosterId: 'roster-a',
      items: [
        { itemType: 'player', itemReference: 'p1', fromRosterId: 'roster-a', toRosterId: 'roster-b' },
        { itemType: 'player', itemReference: 'p2', fromRosterId: 'roster-b', toRosterId: 'roster-a' },
      ],
    })
    const result = await priceTradesAtCurrentMarket({
      leagueId: 'league-1',
      league,
      trades: [trade('one'), trade('two')],
    })

    expect(result.size).toBe(2)
    expect(currentBook).toHaveBeenCalledTimes(1)
  })
})
