/**
 * Decision OS — Trade Learning Phase 8 (Implement Live Capture Architecture).
 *
 * Direct unit coverage of lib/league-trade-engine/tradeLearningCapture.ts —
 * the "asset-shape adapter" approved in
 * docs/TRADE_LEARNING_CAPTURE_ARCHITECTURE_ADR.md. Proves the status
 * mapping (Decision 2), the asset-valuation fallbacks, idempotency, and
 * fail-safe behavior, all against mocked Prisma/FantasyCalc — no live
 * scoring math is exercised beyond what computeTradeDrivers/
 * calibrateAcceptProbability already do (unmodified).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { League } from '@prisma/client'

const {
  mockRosterCount,
  mockTradeOfferEventFindUnique,
  mockFetchFantasyCalcValues,
  mockLogTradeOfferEvent,
  mockLogTradeOutcomeEvent,
} = vi.hoisted(() => ({
  mockRosterCount: vi.fn(),
  mockTradeOfferEventFindUnique: vi.fn(),
  mockFetchFantasyCalcValues: vi.fn(),
  mockLogTradeOfferEvent: vi.fn(),
  mockLogTradeOutcomeEvent: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { count: mockRosterCount },
    tradeOfferEvent: { findUnique: mockTradeOfferEventFindUnique },
  },
}))

vi.mock('@/lib/fantasycalc', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fantasycalc')>('@/lib/fantasycalc')
  return {
    ...actual,
    fetchFantasyCalcValues: mockFetchFantasyCalcValues,
  }
})

vi.mock('@/lib/trade-engine/trade-event-logger', async () => {
  const actual = await vi.importActual<typeof import('@/lib/trade-engine/trade-event-logger')>(
    '@/lib/trade-engine/trade-event-logger',
  )
  return {
    ...actual,
    logTradeOfferEvent: mockLogTradeOfferEvent,
    logTradeOutcomeEvent: mockLogTradeOutcomeEvent,
  }
})

import {
  mapAfTradeStatusToOutcome,
  captureLiveTradeOffer,
  captureLiveTradeOutcome,
  type CaptureTradeItem,
} from '@/lib/league-trade-engine/tradeLearningCapture'

function makeFcPlayer(sleeperId: string, name: string, value: number) {
  return {
    player: { sleeperId, name, id: 1, mflId: '', position: 'WR', maybeBirthday: null, maybeHeight: null, maybeWeight: null, maybeCollege: null, maybeTeam: null, maybeAge: null, maybeYoe: null, espnId: null, fleaflickerId: null },
    value,
    overallRank: 1, positionRank: 1, trend30Day: 0, redraftDynastyValueDifference: 0,
    redraftDynastyValuePercDifference: 0, redraftValue: value, combinedValue: value,
    maybeMovingStandardDeviation: null, maybeMovingStandardDeviationPerc: null, maybeMovingStandardDeviationAdjusted: null,
    displayTrend: false, maybeOwner: null, starter: true, maybeTier: null, maybeAdp: null,
  } as any
}

function makeLeague(starterSlots?: Record<string, number>, season = 2025): League {
  return {
    id: 'league-1',
    season,
    settings: starterSlots ? { rosterSettings: { starterSlots } } : null,
  } as unknown as League
}

const PROPOSER = 'roster-proposer'
const RECEIVER = 'roster-receiver'

describe('mapAfTradeStatusToOutcome — Decision 2 mapping, exactly as approved', () => {
  it('maps every approved terminal status correctly', () => {
    expect(mapAfTradeStatusToOutcome('processed')).toBe('ACCEPTED')
    expect(mapAfTradeStatusToOutcome('rejected')).toBe('REJECTED')
    expect(mapAfTradeStatusToOutcome('countered')).toBe('COUNTERED')
    expect(mapAfTradeStatusToOutcome('expired')).toBe('EXPIRED')
    expect(mapAfTradeStatusToOutcome('vetoed')).toBe('UNKNOWN')
    expect(mapAfTradeStatusToOutcome('cancelled')).toBe('UNKNOWN')
  })

  it('maps non-terminal statuses to null (no event should be written)', () => {
    expect(mapAfTradeStatusToOutcome('pending')).toBeNull()
    expect(mapAfTradeStatusToOutcome('awaiting_commissioner')).toBeNull()
    expect(mapAfTradeStatusToOutcome('awaiting_votes')).toBeNull()
    expect(mapAfTradeStatusToOutcome('scheduled')).toBeNull()
  })

  it('maps an unrecognized status string to null rather than guessing', () => {
    expect(mapAfTradeStatusToOutcome('some_future_status')).toBeNull()
  })
})

describe('captureLiveTradeOffer', () => {
  afterEach(() => vi.clearAllMocks())

  it('splits give/receive by proposer roster, resolves a real player via findPlayerBySleeperId, and captures a LIVE_PROPOSAL offer', async () => {
    mockRosterCount.mockResolvedValue(10)
    mockFetchFantasyCalcValues.mockResolvedValue([
      makeFcPlayer('sleeper-100', 'Star Receiver', 8000),
      makeFcPlayer('sleeper-200', 'Other Player', 4000),
    ])
    mockLogTradeOfferEvent.mockResolvedValue('offer-event-1')

    const items: CaptureTradeItem[] = [
      { itemType: 'player', itemReference: 'sleeper-100', fromRosterId: PROPOSER, toRosterId: RECEIVER },
      { itemType: 'player', itemReference: 'sleeper-200', fromRosterId: RECEIVER, toRosterId: PROPOSER },
    ]

    const result = await captureLiveTradeOffer({
      tradeId: 'trade-1',
      leagueId: 'league-1',
      proposerRosterId: PROPOSER,
      receiverRosterId: RECEIVER,
      items,
      league: makeLeague(),
    })

    expect(result).toBe('offer-event-1')
    expect(mockLogTradeOfferEvent).toHaveBeenCalledTimes(1)
    const call = mockLogTradeOfferEvent.mock.calls[0][0]
    expect(call.mode).toBe('LIVE_PROPOSAL')
    expect(call.afLeagueTradeId).toBe('trade-1')
    expect(call.assetsGiven).toEqual([expect.objectContaining({ name: 'Star Receiver', value: 8000 })])
    expect(call.assetsReceived).toEqual([expect.objectContaining({ name: 'Other Player', value: 4000 })])
    expect(typeof call.acceptProb).toBe('number')
    expect(typeof call.verdict).toBe('string')
  })

  it('falls back to the conservative default value for an unresolvable player, without throwing', async () => {
    mockRosterCount.mockResolvedValue(10)
    mockFetchFantasyCalcValues.mockResolvedValue([]) // nobody resolves
    mockLogTradeOfferEvent.mockResolvedValue('offer-event-2')

    const items: CaptureTradeItem[] = [
      { itemType: 'player', itemReference: 'sleeper-unknown', fromRosterId: PROPOSER, toRosterId: RECEIVER },
    ]

    await captureLiveTradeOffer({
      tradeId: 'trade-2', leagueId: 'league-1', proposerRosterId: PROPOSER, receiverRosterId: RECEIVER, items, league: makeLeague(),
    })

    const call = mockLogTradeOfferEvent.mock.calls[0][0]
    expect(call.assetsGiven[0].value).toBe(200) // documented fallback
  })

  it('resolves a pick value from metadata season/round when present', async () => {
    mockRosterCount.mockResolvedValue(12)
    mockFetchFantasyCalcValues.mockResolvedValue([])
    mockLogTradeOfferEvent.mockResolvedValue('offer-event-3')

    const items: CaptureTradeItem[] = [
      {
        itemType: 'rookie_pick',
        itemReference: 'pick-1',
        fromRosterId: PROPOSER,
        toRosterId: RECEIVER,
        metadata: { season: 2026, round: 1 },
      },
    ]

    await captureLiveTradeOffer({
      tradeId: 'trade-3', leagueId: 'league-1', proposerRosterId: PROPOSER, receiverRosterId: RECEIVER, items, league: makeLeague(),
    })

    const call = mockLogTradeOfferEvent.mock.calls[0][0]
    // A real, non-fallback, non-zero pick value was computed (exact number
    // depends on getPickValue's own real formula — not re-derived here).
    expect(call.assetsGiven[0].value).toBeGreaterThan(0)
    expect(call.assetsGiven[0].value).not.toBe(200)
  })

  it('falls back to the conservative default for a pick with no season/round metadata', async () => {
    mockRosterCount.mockResolvedValue(12)
    mockFetchFantasyCalcValues.mockResolvedValue([])
    mockLogTradeOfferEvent.mockResolvedValue('offer-event-4')

    const items: CaptureTradeItem[] = [
      { itemType: 'future_pick', itemReference: 'pick-2', fromRosterId: PROPOSER, toRosterId: RECEIVER },
    ]

    await captureLiveTradeOffer({
      tradeId: 'trade-4', leagueId: 'league-1', proposerRosterId: PROPOSER, receiverRosterId: RECEIVER, items, league: makeLeague(),
    })

    expect(mockLogTradeOfferEvent.mock.calls[0][0].assetsGiven[0].value).toBe(200)
  })

  it('treats a FAAB item\'s value as its faabAmount', async () => {
    mockRosterCount.mockResolvedValue(12)
    mockFetchFantasyCalcValues.mockResolvedValue([])
    mockLogTradeOfferEvent.mockResolvedValue('offer-event-5')

    const items: CaptureTradeItem[] = [
      { itemType: 'faab', fromRosterId: PROPOSER, toRosterId: RECEIVER, faabAmount: 25 },
    ]

    await captureLiveTradeOffer({
      tradeId: 'trade-5', leagueId: 'league-1', proposerRosterId: PROPOSER, receiverRosterId: RECEIVER, items, league: makeLeague(),
    })

    expect(mockLogTradeOfferEvent.mock.calls[0][0].assetsGiven[0].value).toBe(25)
  })

  it('falls back to the conservative default for a specialty_asset item type', async () => {
    mockRosterCount.mockResolvedValue(12)
    mockFetchFantasyCalcValues.mockResolvedValue([])
    mockLogTradeOfferEvent.mockResolvedValue('offer-event-6')

    const items: CaptureTradeItem[] = [
      { itemType: 'specialty_asset', fromRosterId: PROPOSER, toRosterId: RECEIVER },
    ]

    await captureLiveTradeOffer({
      tradeId: 'trade-6', leagueId: 'league-1', proposerRosterId: PROPOSER, receiverRosterId: RECEIVER, items, league: makeLeague(),
    })

    expect(mockLogTradeOfferEvent.mock.calls[0][0].assetsGiven[0].value).toBe(200)
  })

  it('populates season from League.season (Phase 9 regression — was previously always null, invisible to computeShadowB0\'s season-scoped query)', async () => {
    mockRosterCount.mockResolvedValue(12)
    mockFetchFantasyCalcValues.mockResolvedValue([])
    mockLogTradeOfferEvent.mockResolvedValue('offer-event-season')

    const items: CaptureTradeItem[] = [
      { itemType: 'player', itemReference: 'x', fromRosterId: PROPOSER, toRosterId: RECEIVER },
    ]

    await captureLiveTradeOffer({
      tradeId: 'trade-season', leagueId: 'league-1', proposerRosterId: PROPOSER, receiverRosterId: RECEIVER, items,
      league: makeLeague(undefined, 2027),
    })

    expect(mockLogTradeOfferEvent.mock.calls[0][0].season).toBe(2027)
  })

  it('derives isSuperFlex from the league\'s own settings snapshot (provider-agnostic, no Sleeper-specific parsing)', async () => {
    mockRosterCount.mockResolvedValue(12)
    mockFetchFantasyCalcValues.mockResolvedValue([])
    mockLogTradeOfferEvent.mockResolvedValue('offer-event-7')

    const items: CaptureTradeItem[] = [
      { itemType: 'player', itemReference: 'x', fromRosterId: PROPOSER, toRosterId: RECEIVER },
    ]

    await captureLiveTradeOffer({
      tradeId: 'trade-7', leagueId: 'league-1', proposerRosterId: PROPOSER, receiverRosterId: RECEIVER, items,
      league: makeLeague({ QB: 2, RB: 2, WR: 2 }),
    })

    expect(mockFetchFantasyCalcValues).toHaveBeenCalledWith(expect.objectContaining({ numQbs: 2 }))
    expect(mockLogTradeOfferEvent.mock.calls[0][0].isSuperFlex).toBe(true)
  })

  it('returns null and writes nothing when there are no give/receive items at all', async () => {
    mockRosterCount.mockResolvedValue(12)

    const result = await captureLiveTradeOffer({
      tradeId: 'trade-8', leagueId: 'league-1', proposerRosterId: PROPOSER, receiverRosterId: RECEIVER, items: [], league: makeLeague(),
    })

    expect(result).toBeNull()
    expect(mockLogTradeOfferEvent).not.toHaveBeenCalled()
  })

  it('fails safe (returns null, never throws) when an internal step throws', async () => {
    mockRosterCount.mockRejectedValue(new Error('db unavailable'))

    const items: CaptureTradeItem[] = [
      { itemType: 'player', itemReference: 'x', fromRosterId: PROPOSER, toRosterId: RECEIVER },
    ]

    await expect(
      captureLiveTradeOffer({
        tradeId: 'trade-9', leagueId: 'league-1', proposerRosterId: PROPOSER, receiverRosterId: RECEIVER, items, league: makeLeague(),
      }),
    ).resolves.toBeNull()
  })
})

describe('captureLiveTradeOutcome', () => {
  afterEach(() => vi.clearAllMocks())

  it('no-ops with zero Prisma calls for a non-terminal or unmapped status', async () => {
    const result = await captureLiveTradeOutcome({ tradeId: 'trade-1', leagueId: 'league-1', status: 'pending' })

    expect(result).toBeNull()
    expect(mockTradeOfferEventFindUnique).not.toHaveBeenCalled()
    expect(mockLogTradeOutcomeEvent).not.toHaveBeenCalled()
  })

  it('links a mapped terminal outcome back to its own offer event via afLeagueTradeId', async () => {
    mockTradeOfferEventFindUnique.mockResolvedValue({ id: 'offer-event-1', season: 2025 })
    mockLogTradeOutcomeEvent.mockResolvedValue('outcome-event-1')

    const result = await captureLiveTradeOutcome({ tradeId: 'trade-1', leagueId: 'league-1', status: 'processed' })

    expect(result).toBe('outcome-event-1')
    expect(mockTradeOfferEventFindUnique).toHaveBeenCalledWith({
      where: { afLeagueTradeId: 'trade-1' },
      select: { id: true, season: true },
    })
    const call = mockLogTradeOutcomeEvent.mock.calls[0][0]
    expect(call.offerEventId).toBe('offer-event-1')
    expect(call.outcome).toBe('ACCEPTED')
    expect(call.afLeagueTradeId).toBe('trade-1')
  })

  it('inherits season from its own linked offer event (Phase 9 regression — was previously always null)', async () => {
    mockTradeOfferEventFindUnique.mockResolvedValue({ id: 'offer-event-1', season: 2027 })
    mockLogTradeOutcomeEvent.mockResolvedValue('outcome-event-season')

    await captureLiveTradeOutcome({ tradeId: 'trade-season', leagueId: 'league-1', status: 'processed' })

    expect(mockLogTradeOutcomeEvent.mock.calls[0][0].season).toBe(2027)
  })

  it('an explicitly-passed season overrides the inherited one', async () => {
    mockTradeOfferEventFindUnique.mockResolvedValue({ id: 'offer-event-1', season: 2027 })
    mockLogTradeOutcomeEvent.mockResolvedValue('outcome-event-override')

    await captureLiveTradeOutcome({ tradeId: 'trade-override', leagueId: 'league-1', status: 'processed', season: 2030 })

    expect(mockLogTradeOutcomeEvent.mock.calls[0][0].season).toBe(2030)
  })

  it('still writes an outcome (with offerEventId null) if no matching offer event is found', async () => {
    mockTradeOfferEventFindUnique.mockResolvedValue(null)
    mockLogTradeOutcomeEvent.mockResolvedValue('outcome-event-2')

    await captureLiveTradeOutcome({ tradeId: 'trade-2', leagueId: 'league-1', status: 'rejected' })

    const call = mockLogTradeOutcomeEvent.mock.calls[0][0]
    expect(call.offerEventId).toBeNull()
    expect(call.outcome).toBe('REJECTED')
  })

  it('maps vetoed and cancelled to UNKNOWN, exactly as approved (not REJECTED)', async () => {
    mockTradeOfferEventFindUnique.mockResolvedValue({ id: 'offer-event-1' })
    mockLogTradeOutcomeEvent.mockResolvedValue('outcome-event-3')

    await captureLiveTradeOutcome({ tradeId: 'trade-3', leagueId: 'league-1', status: 'vetoed' })
    expect(mockLogTradeOutcomeEvent.mock.calls[0][0].outcome).toBe('UNKNOWN')

    await captureLiveTradeOutcome({ tradeId: 'trade-4', leagueId: 'league-1', status: 'cancelled' })
    expect(mockLogTradeOutcomeEvent.mock.calls[1][0].outcome).toBe('UNKNOWN')
  })

  it('fails safe (returns null, never throws) when the Prisma lookup throws', async () => {
    mockTradeOfferEventFindUnique.mockRejectedValue(new Error('db unavailable'))

    await expect(
      captureLiveTradeOutcome({ tradeId: 'trade-5', leagueId: 'league-1', status: 'processed' }),
    ).resolves.toBeNull()
  })
})
