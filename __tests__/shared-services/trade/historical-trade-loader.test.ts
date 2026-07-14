/**
 * Tests for HistoricalTradeLoader.ts — Trade Shadow Backtest, Phase 6.
 * Mocks prisma only; exercises the real filtering/normalization logic,
 * including the two real translation steps documented in the loader's
 * own docstring (source_team_id resolution, native-platform exclusion).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockOfferFindMany,
  mockAfLeagueTradeFindUnique,
  mockRosterFindUnique,
  mockOutcomeFindUnique,
} = vi.hoisted(() => ({
  mockOfferFindMany: vi.fn(),
  mockAfLeagueTradeFindUnique: vi.fn(),
  mockRosterFindUnique: vi.fn(),
  mockOutcomeFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tradeOfferEvent: { findMany: mockOfferFindMany },
    afLeagueTrade: { findUnique: mockAfLeagueTradeFindUnique },
    roster: { findUnique: mockRosterFindUnique },
    tradeOutcomeEvent: { findUnique: mockOutcomeFindUnique },
  },
}))

import { loadHistoricalTradeSamples } from '@/lib/shared-services/trade/backtest/HistoricalTradeLoader'

const BASE_OFFER = {
  id: 'offer-1',
  afLeagueTradeId: 'trade-1',
  assetsGiven: [{ name: 'Patrick Mahomes', value: 9000, type: 'player' }],
  assetsReceived: [{ name: 'Josh Allen', value: 8800, type: 'player' }],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}

const BASE_TRADE = {
  id: 'trade-1',
  status: 'processed',
  proposerRosterId: 'roster-a',
  receiverRosterId: 'roster-b',
  league: { id: 'league-1', platformLeagueId: 'sleeper-league-1', platform: 'sleeper', userId: 'af-user-1' },
}

const ROSTER_WITH_SOURCE_ID = (id: string) => ({ playerData: { source_team_id: id } })

describe('loadHistoricalTradeSamples', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOutcomeFindUnique.mockResolvedValue(null)
  })

  it('queries only real, native-trade LIVE_PROPOSAL offer events', async () => {
    mockOfferFindMany.mockResolvedValue([])
    await loadHistoricalTradeSamples()
    expect(mockOfferFindMany).toHaveBeenCalledWith({
      where: { mode: 'LIVE_PROPOSAL', afLeagueTradeId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
  })

  it('normalizes a complete, terminal, provider-backed trade into a backtestable sample', async () => {
    mockOfferFindMany.mockResolvedValue([BASE_OFFER])
    mockAfLeagueTradeFindUnique.mockResolvedValue(BASE_TRADE)
    mockRosterFindUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(where.id === 'roster-a' ? ROSTER_WITH_SOURCE_ID('1') : ROSTER_WITH_SOURCE_ID('2'))
    )

    const result = await loadHistoricalTradeSamples()

    expect(result.skipped).toEqual([])
    expect(result.samples).toHaveLength(1)
    expect(result.samples[0]).toEqual({
      offerEventId: 'offer-1',
      afLeagueTradeId: 'trade-1',
      leagueId: 'league-1',
      platformLeagueId: 'sleeper-league-1',
      platform: 'sleeper',
      afUserId: 'af-user-1',
      sideARosterId: '1',
      sideBRosterId: '2',
      sideAAssetNames: ['Patrick Mahomes'],
      sideBAssetNames: ['Josh Allen'],
      realOutcome: 'ACCEPTED',
      capturedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('reads source_team_id from the nested import.sourceTeamId fallback shape', async () => {
    mockOfferFindMany.mockResolvedValue([BASE_OFFER])
    mockAfLeagueTradeFindUnique.mockResolvedValue(BASE_TRADE)
    mockRosterFindUnique.mockResolvedValue({ playerData: { import: { sourceTeamId: 3 } } })

    const result = await loadHistoricalTradeSamples()
    expect(result.samples[0].sideARosterId).toBe('3')
  })

  it('prefers a real captured TradeOutcomeEvent over the status-derived outcome', async () => {
    mockOfferFindMany.mockResolvedValue([BASE_OFFER])
    mockAfLeagueTradeFindUnique.mockResolvedValue(BASE_TRADE)
    mockRosterFindUnique.mockResolvedValue(ROSTER_WITH_SOURCE_ID('1'))
    mockOutcomeFindUnique.mockResolvedValue({ outcome: 'COUNTERED' })

    const result = await loadHistoricalTradeSamples()
    expect(result.samples[0].realOutcome).toBe('COUNTERED')
  })

  it('skips a trade still in a non-terminal status', async () => {
    mockOfferFindMany.mockResolvedValue([BASE_OFFER])
    mockAfLeagueTradeFindUnique.mockResolvedValue({ ...BASE_TRADE, status: 'pending' })

    const result = await loadHistoricalTradeSamples()
    expect(result.samples).toEqual([])
    expect(result.skipped).toEqual([{ offerEventId: 'offer-1', afLeagueTradeId: 'trade-1', reason: 'trade_not_terminal:pending' }])
  })

  it('skips a trade on a natively-created (non-imported) league', async () => {
    mockOfferFindMany.mockResolvedValue([BASE_OFFER])
    mockAfLeagueTradeFindUnique.mockResolvedValue({
      ...BASE_TRADE,
      league: { ...BASE_TRADE.league, platform: 'native' },
    })

    const result = await loadHistoricalTradeSamples()
    expect(result.samples).toEqual([])
    expect(result.skipped).toEqual([{ offerEventId: 'offer-1', afLeagueTradeId: 'trade-1', reason: 'unsupported_platform:native' }])
  })

  it('skips a trade whose roster has no resolvable provider source_team_id', async () => {
    mockOfferFindMany.mockResolvedValue([BASE_OFFER])
    mockAfLeagueTradeFindUnique.mockResolvedValue(BASE_TRADE)
    mockRosterFindUnique.mockResolvedValue({ playerData: {} })

    const result = await loadHistoricalTradeSamples()
    expect(result.samples).toEqual([])
    expect(result.skipped).toEqual([{ offerEventId: 'offer-1', afLeagueTradeId: 'trade-1', reason: 'missing_source_team_id' }])
  })

  it('skips a trade whose captured assets have no names', async () => {
    mockOfferFindMany.mockResolvedValue([{ ...BASE_OFFER, assetsGiven: [], assetsReceived: [] }])
    mockAfLeagueTradeFindUnique.mockResolvedValue(BASE_TRADE)
    mockRosterFindUnique.mockResolvedValue(ROSTER_WITH_SOURCE_ID('1'))

    const result = await loadHistoricalTradeSamples()
    expect(result.samples).toEqual([])
    expect(result.skipped).toEqual([{ offerEventId: 'offer-1', afLeagueTradeId: 'trade-1', reason: 'no_asset_names' }])
  })

  it('skips a trade whose AfLeagueTrade row no longer exists', async () => {
    mockOfferFindMany.mockResolvedValue([BASE_OFFER])
    mockAfLeagueTradeFindUnique.mockResolvedValue(null)

    const result = await loadHistoricalTradeSamples()
    expect(result.skipped).toEqual([{ offerEventId: 'offer-1', afLeagueTradeId: 'trade-1', reason: 'af_league_trade_not_found' }])
  })

  it('handles an empty corpus cleanly', async () => {
    mockOfferFindMany.mockResolvedValue([])
    const result = await loadHistoricalTradeSamples()
    expect(result).toEqual({ samples: [], skipped: [], totalCandidates: 0 })
  })

  it('respects a custom limit', async () => {
    mockOfferFindMany.mockResolvedValue([])
    await loadHistoricalTradeSamples({ limit: 50 })
    expect(mockOfferFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }))
  })
})
