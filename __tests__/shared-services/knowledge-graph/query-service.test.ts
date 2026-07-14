import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getManagerBehaviorProfile, getPlayerExposure } from '@/lib/shared-services/knowledge-graph/QueryService'
import { InMemorySignalStore } from '@/lib/shared-services/knowledge-graph/SignalStore'
import { InMemorySnapshotStore } from '@/lib/shared-services/knowledge-graph/SnapshotStore'
import { MINIMUM_COHORT_LEAGUES } from '@/lib/shared-services/knowledge-graph/PrivacyGate'
import type { Signal } from '@/lib/shared-services/knowledge-graph/types'

function makeSignal(leagueId: string, managerKey: string): Signal {
  return {
    id: Math.random().toString(),
    signalType: 'trade_accepted',
    leagueId,
    managerKey,
    occurredAt: new Date(),
    payload: {},
    sourceAttribution: { source: 'af_native', emittedFrom: 'test', recordedAt: new Date() },
  }
}

async function seedCohort(store: InMemorySignalStore, count: number) {
  for (let i = 0; i < count; i++) {
    await store.append(makeSignal(`league-${i}`, 'user-1'))
  }
}

describe('getManagerBehaviorProfile — privacy gate', () => {
  it('returns gated when the platform-wide cohort is below the minimum', async () => {
    const signalStore = new InMemorySignalStore()
    const snapshotStore = new InMemorySnapshotStore()
    await seedCohort(signalStore, 5)

    const result = await getManagerBehaviorProfile('user-1', { signalStore, snapshotStore })
    expect(result.status).toBe('gated')
  })

  it('returns ok once the cohort meets the minimum', async () => {
    const signalStore = new InMemorySignalStore()
    const snapshotStore = new InMemorySnapshotStore()
    await seedCohort(signalStore, MINIMUM_COHORT_LEAGUES)

    const result = await getManagerBehaviorProfile('user-1', { signalStore, snapshotStore })
    expect(result.status).toBe('ok')
  })

  it('never ships an aggregate that fails the gate — no partial/fabricated data leaks through', async () => {
    const signalStore = new InMemorySignalStore()
    const snapshotStore = new InMemorySnapshotStore()
    await seedCohort(signalStore, 1)

    const result = await getManagerBehaviorProfile('user-1', { signalStore, snapshotStore })
    expect(result).not.toHaveProperty('data')
    expect((result as { reason: string }).reason).toBeTruthy()
  })
})

describe('getManagerBehaviorProfile — versioning', () => {
  let signalStore: InMemorySignalStore
  let snapshotStore: InMemorySnapshotStore

  beforeEach(async () => {
    signalStore = new InMemorySignalStore()
    snapshotStore = new InMemorySnapshotStore()
    await seedCohort(signalStore, MINIMUM_COHORT_LEAGUES)
  })

  it('persists a new version to the snapshot store on every call, never overwriting', async () => {
    const appendSpy = vi.spyOn(snapshotStore, 'appendManagerBehaviorProfile')

    const first = await getManagerBehaviorProfile('user-1', { signalStore, snapshotStore })
    const second = await getManagerBehaviorProfile('user-1', { signalStore, snapshotStore })

    expect(first.status).toBe('ok')
    expect(second.status).toBe('ok')
    // Two calls append two distinct version objects — never a single update-in-place.
    expect(appendSpy).toHaveBeenCalledTimes(2)
    if (first.status === 'ok' && second.status === 'ok') {
      expect(first.data).not.toBe(second.data)
    }

    const latest = await snapshotStore.latestManagerBehaviorProfile('user-1')
    expect(latest).not.toBeNull()
  })
})

describe('getPlayerExposure', () => {
  it('uses a roster/cohort loader independent of the trade/waiver signal store', async () => {
    const snapshotStore = new InMemorySnapshotStore()
    const rosterLoader = async () => [
      { leagueId: 'league-1', playerIds: ['player-1'] },
      { leagueId: 'league-2', playerIds: [] },
    ]
    const cohortLoader = async () => MINIMUM_COHORT_LEAGUES

    const result = await getPlayerExposure('user-1', 'player-1', { snapshotStore, rosterLoader, cohortLoader })
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.data.value.exposureShare).toBeCloseTo(0.5)
    }
  })

  it('is gated independently of whether any trade/waiver signals exist (no signal-store coupling)', async () => {
    const snapshotStore = new InMemorySnapshotStore()
    const rosterLoader = async () => [{ leagueId: 'league-1', playerIds: ['player-1'] }]
    const cohortLoader = async () => 2 // below threshold, roster-data cohort specifically

    const result = await getPlayerExposure('user-1', 'player-1', { snapshotStore, rosterLoader, cohortLoader })
    expect(result.status).toBe('gated')
  })

  it('persists a new versioned snapshot on every call', async () => {
    const snapshotStore = new InMemorySnapshotStore()
    const rosterLoader = async () => [{ leagueId: 'league-1', playerIds: ['player-1'] }]
    const cohortLoader = async () => MINIMUM_COHORT_LEAGUES

    await getPlayerExposure('user-1', 'player-1', { snapshotStore, rosterLoader, cohortLoader })
    const latest = await snapshotStore.latestPlayerExposure('user-1', 'player-1')
    expect(latest).not.toBeNull()
    expect(latest?.value.playerId).toBe('player-1')
  })
})
