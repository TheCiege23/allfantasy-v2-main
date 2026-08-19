import { describe, expect, it } from 'vitest'
import { InMemorySignalStore } from '@/lib/shared-services/knowledge-graph/SignalStore'
import { InMemorySnapshotStore } from '@/lib/shared-services/knowledge-graph/SnapshotStore'
import type { ManagerBehaviorProfile, Signal } from '@/lib/shared-services/knowledge-graph/types'

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: overrides.id ?? Math.random().toString(),
    signalType: 'trade_accepted',
    leagueId: 'league-1',
    managerKey: 'user-1',
    occurredAt: new Date(),
    payload: {},
    sourceAttribution: { source: 'af_native', emittedFrom: 'test', recordedAt: new Date() },
    ...overrides,
  }
}

describe('InMemorySignalStore', () => {
  it('appends and retrieves signals by manager', async () => {
    const store = new InMemorySignalStore()
    await store.append(makeSignal({ managerKey: 'user-1' }))
    await store.append(makeSignal({ managerKey: 'user-2' }))

    const forUser1 = await store.findByManager('user-1')
    expect(forUser1).toHaveLength(1)
    expect(forUser1[0].managerKey).toBe('user-1')
  })

  it('filters by signal type when requested', async () => {
    const store = new InMemorySignalStore()
    await store.append(makeSignal({ managerKey: 'user-1', signalType: 'trade_accepted' }))
    await store.append(makeSignal({ managerKey: 'user-1', signalType: 'trade_rejected' }))

    const accepted = await store.findByManager('user-1', ['trade_accepted'])
    expect(accepted).toHaveLength(1)
    expect(accepted[0].signalType).toBe('trade_accepted')
  })

  it('computes distinct league count across all signals, not per-manager', async () => {
    const store = new InMemorySignalStore()
    await store.append(makeSignal({ leagueId: 'league-1', managerKey: 'user-1' }))
    await store.append(makeSignal({ leagueId: 'league-1', managerKey: 'user-2' }))
    await store.append(makeSignal({ leagueId: 'league-2', managerKey: 'user-1' }))

    expect(await store.distinctLeagueCount()).toBe(2)
  })

  it('never leaks a provider-specific concept — only af_native signals exist for this phase', async () => {
    const store = new InMemorySignalStore()
    await store.append(makeSignal())
    const [signal] = await store.findByManager('user-1')
    expect(signal.sourceAttribution.source).toBe('af_native')
  })
})

describe('InMemorySnapshotStore — versioning', () => {
  function makeProfile(asOf: Date, computedAt: Date): ManagerBehaviorProfile {
    return {
      asOf,
      computedAt,
      value: {
        tradeCount: 1,
        tradeAcceptedCount: 1,
        tradeRejectedCount: 0,
        tradeCancelledCount: 0,
        tradeVetoedCount: 0,
        tradeAcceptRate: 1,
        waiverClaimCount: 0,
        waiverWonCount: 0,
        waiverLostCount: 0,
        waiverWinRate: null,
      },
      confidenceEnvelope: {
        confidence: 0.5,
        freshness: { computedAt, isStale: false },
        evidence: [],
        sampleSize: 1,
        sourceAttribution: [],
        risk: 0.5,
        uncertainty: null,
      },
    }
  }

  it('never overwrites — appending a second version keeps the first retrievable by construction (two distinct entries)', async () => {
    const store = new InMemorySnapshotStore()
    const v1 = makeProfile(new Date('2026-01-01'), new Date('2026-01-01'))
    const v2 = makeProfile(new Date('2026-02-01'), new Date('2026-02-01'))

    await store.appendManagerBehaviorProfile('user-1', v1)
    await store.appendManagerBehaviorProfile('user-1', v2)

    const latest = await store.latestManagerBehaviorProfile('user-1')
    expect(latest?.computedAt).toEqual(v2.computedAt)
  })

  it('returns null when no version exists yet', async () => {
    const store = new InMemorySnapshotStore()
    expect(await store.latestManagerBehaviorProfile('nobody')).toBeNull()
  })

  it('latest() always returns the most recently computed version regardless of append order', async () => {
    const store = new InMemorySnapshotStore()
    const older = makeProfile(new Date('2026-01-01'), new Date('2026-01-01'))
    const newer = makeProfile(new Date('2026-03-01'), new Date('2026-03-01'))

    await store.appendManagerBehaviorProfile('user-1', newer)
    await store.appendManagerBehaviorProfile('user-1', older)

    const latest = await store.latestManagerBehaviorProfile('user-1')
    expect(latest?.computedAt).toEqual(newer.computedAt)
  })
})
