import { beforeEach, describe, expect, it, vi } from 'vitest'
import { captureTradeSignal, captureWaiverSignal } from '@/lib/shared-services/knowledge-graph/SignalIngestionService'
import { InMemorySignalStore } from '@/lib/shared-services/knowledge-graph/SignalStore'

describe('captureTradeSignal', () => {
  let store: InMemorySignalStore

  beforeEach(() => {
    store = new InMemorySignalStore()
  })

  it('records a well-formed, source-attributed signal', async () => {
    await captureTradeSignal({
      signalType: 'trade_accepted',
      leagueId: 'league-1',
      managerKey: 'user-1',
      tradeId: 'trade-1',
      emittedFrom: 'test',
      store,
    })

    const signals = await store.findByManager('user-1')
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      signalType: 'trade_accepted',
      leagueId: 'league-1',
      managerKey: 'user-1',
      payload: { tradeId: 'trade-1' },
    })
    expect(signals[0].sourceAttribution).toMatchObject({ source: 'af_native', emittedFrom: 'test' })
    expect(signals[0].sourceAttribution.recordedAt).toBeInstanceOf(Date)
    expect(signals[0].occurredAt).toBeInstanceOf(Date)
    expect(typeof signals[0].id).toBe('string')
  })

  it('never throws when the underlying store fails (fails safe)', async () => {
    const failingStore = { append: vi.fn().mockRejectedValue(new Error('db down')) } as any
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      captureTradeSignal({
        signalType: 'trade_rejected',
        leagueId: 'league-1',
        managerKey: 'user-1',
        tradeId: 'trade-1',
        emittedFrom: 'test',
        store: failingStore,
      })
    ).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalled()
  })
})

describe('captureWaiverSignal', () => {
  let store: InMemorySignalStore

  beforeEach(() => {
    store = new InMemorySignalStore()
  })

  it('records a well-formed waiver signal with claim/player payload', async () => {
    await captureWaiverSignal({
      signalType: 'waiver_claim_won',
      leagueId: 'league-1',
      managerKey: 'user-2',
      claimId: 'claim-1',
      addPlayerId: 'player-a',
      dropPlayerId: 'player-b',
      emittedFrom: 'test',
      store,
    })

    const signals = await store.findByManager('user-2')
    expect(signals).toHaveLength(1)
    expect(signals[0].payload).toEqual({ claimId: 'claim-1', addPlayerId: 'player-a', dropPlayerId: 'player-b' })
  })

  it('never throws when the underlying store fails (fails safe)', async () => {
    const failingStore = { append: vi.fn().mockRejectedValue(new Error('db down')) } as any
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      captureWaiverSignal({
        signalType: 'waiver_claim_lost',
        leagueId: 'league-1',
        managerKey: 'user-2',
        claimId: 'claim-1',
        addPlayerId: 'player-a',
        emittedFrom: 'test',
        store: failingStore,
      })
    ).resolves.toBeUndefined()
  })
})
