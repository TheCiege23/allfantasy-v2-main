import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryGameDaySnapshotStore } from '@/lib/shared-services/game-day/GameDaySnapshotStore'
import type { GameDaySnapshot } from '@/lib/shared-services/game-day/types'

function makeSnapshot(overrides: Partial<GameDaySnapshot> = {}): GameDaySnapshot {
  return {
    snapshotId: 'snap-1',
    userId: 'user-1',
    generatedAt: new Date().toISOString(),
    includedLeagueIds: [],
    leagues: [],
    exposures: [],
    attentionItems: [],
    gameWindows: [],
    managerTendency: { status: 'unavailable', reason: null, profile: null },
    dataQuality: { leagueCount: 0, unavailableLeagueCount: 0, staleMatchupCount: 0 },
    freshnessSummary: { oldestFetchedAt: null, newestFetchedAt: null },
    divergence: [],
    ...overrides,
  }
}

describe('InMemoryGameDaySnapshotStore', () => {
  let store: InMemoryGameDaySnapshotStore

  beforeEach(() => {
    store = new InMemoryGameDaySnapshotStore()
  })

  it('appends and returns all snapshots', async () => {
    await store.append(makeSnapshot())
    await store.append(makeSnapshot({ snapshotId: 'snap-2' }))
    expect(await store.all()).toHaveLength(2)
  })

  it('latestForUser returns the most recently generated snapshot for that user only', async () => {
    await store.append(makeSnapshot({ snapshotId: 's1', userId: 'user-1', generatedAt: '2026-01-01T00:00:00.000Z' }))
    await store.append(makeSnapshot({ snapshotId: 's2', userId: 'user-1', generatedAt: '2026-01-02T00:00:00.000Z' }))
    await store.append(makeSnapshot({ snapshotId: 's3', userId: 'user-2', generatedAt: '2026-01-03T00:00:00.000Z' }))

    const latest = await store.latestForUser('user-1')
    expect(latest?.snapshotId).toBe('s2')
  })

  it('returns null when the user has no snapshots', async () => {
    expect(await store.latestForUser('nobody')).toBeNull()
  })

  it('empty store returns empty arrays', async () => {
    expect(await store.all()).toEqual([])
  })
})
