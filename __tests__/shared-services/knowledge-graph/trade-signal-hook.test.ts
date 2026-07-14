import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRosterFindMany, mockCaptureTradeSignal } = vi.hoisted(() => ({
  mockRosterFindMany: vi.fn(),
  mockCaptureTradeSignal: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { roster: { findMany: mockRosterFindMany } },
}))
vi.mock('@/lib/shared-services/knowledge-graph/SignalIngestionService', () => ({
  captureTradeSignal: mockCaptureTradeSignal,
}))

import { recordTradeOutcomeSignal } from '@/lib/shared-services/knowledge-graph/TradeSignalHook'

describe('recordTradeOutcomeSignal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCaptureTradeSignal.mockResolvedValue(undefined)
  })

  it('captures a signal for both the proposer and receiver managers', async () => {
    mockRosterFindMany.mockResolvedValue([
      { id: 'roster-proposer', platformUserId: 'user-1' },
      { id: 'roster-receiver', platformUserId: 'user-2' },
    ])

    await recordTradeOutcomeSignal({
      tradeId: 'trade-1',
      leagueId: 'league-1',
      proposerRosterId: 'roster-proposer',
      receiverRosterId: 'roster-receiver',
      outcome: 'trade_accepted',
      emittedFrom: 'test',
    })

    expect(mockCaptureTradeSignal).toHaveBeenCalledTimes(2)
    expect(mockCaptureTradeSignal).toHaveBeenCalledWith(
      expect.objectContaining({ signalType: 'trade_accepted', managerKey: 'user-1', tradeId: 'trade-1' })
    )
    expect(mockCaptureTradeSignal).toHaveBeenCalledWith(
      expect.objectContaining({ signalType: 'trade_accepted', managerKey: 'user-2', tradeId: 'trade-1' })
    )
  })

  it('skips a roster with no platformUserId rather than capturing a malformed signal', async () => {
    mockRosterFindMany.mockResolvedValue([
      { id: 'roster-proposer', platformUserId: 'user-1' },
      { id: 'roster-receiver', platformUserId: '' },
    ])

    await recordTradeOutcomeSignal({
      tradeId: 'trade-1',
      leagueId: 'league-1',
      proposerRosterId: 'roster-proposer',
      receiverRosterId: 'roster-receiver',
      outcome: 'trade_rejected',
      emittedFrom: 'test',
    })

    expect(mockCaptureTradeSignal).toHaveBeenCalledTimes(1)
  })

  it('never throws when the roster lookup fails — a Knowledge Graph failure must never affect a real trade', async () => {
    mockRosterFindMany.mockRejectedValue(new Error('db down'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      recordTradeOutcomeSignal({
        tradeId: 'trade-1',
        leagueId: 'league-1',
        proposerRosterId: 'roster-proposer',
        receiverRosterId: 'roster-receiver',
        outcome: 'trade_cancelled',
        emittedFrom: 'test',
      })
    ).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
  })
})
