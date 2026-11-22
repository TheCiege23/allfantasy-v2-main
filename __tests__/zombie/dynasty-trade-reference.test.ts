import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ dynasty: true, source: 'fantasycalc' }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/trade-value-console/league-loader', () => ({ loadLeagueForTrade: async () => ({ id: 'l' }) }))
vi.mock('@/lib/trade-value-console/quick-badges', () => ({ snapshotFromLoaded: () => ({ isDynasty: h.dynasty }) }))
vi.mock('@/lib/trade-value-console/leagueTradePricing', () => ({
  resolveLeagueTradeChart: async () => ({ chartIsDynasty: h.dynasty, fcPlayers: [{}], fcSyncedAt: '2026-11-01', nflCtx: {}, waiverBudget: 0 }),
  resolveAssets: async (assets: unknown[]) => ({ unresolved: [], lines: assets.map(() => ({ marketValue: 1000, pricedSource: h.source, unpriced: false })) }),
}))
import { zombieDynastyTradeReference } from '@/lib/zombie/dynastyTradeReference'
const input = { leagueId: 'l', userId: 'u', proposerRosterId: 'a', receiverRosterId: 'b', assets: [
  { assetType: 'player', fromRosterId: 'a', toRosterId: 'b', playerId: 'p', playerName: 'Player' },
  { assetType: 'zombie_item', fromRosterId: 'b', toRosterId: 'a' },
] }
beforeEach(() => { h.dynasty = true; h.source = 'fantasycalc' })
describe('Zombie dynasty market reference', () => {
  it('prices only the player packages and states the market capture date', async () => {
    expect(await zombieDynastyTradeReference(input)).toEqual({ giveValue: 1000, getValue: 0, asOf: '2026-11-01' })
  })
  it('withholds references for redraft leagues and fallback value sources', async () => {
    h.dynasty = false
    expect(await zombieDynastyTradeReference(input)).toBeNull()
    h.dynasty = true
    h.source = 'placeholder'
    expect(await zombieDynastyTradeReference(input)).toBeNull()
  })
})
