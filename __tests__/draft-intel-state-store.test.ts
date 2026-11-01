import { describe, expect, it, vi } from 'vitest'

import { draftIntelStateStore } from '@/lib/draft-intelligence'

describe('draftIntelStateStore', () => {
  it('stores snapshots and emits queue update envelopes', () => {
    const listener = vi.fn()
    const unsubscribe = draftIntelStateStore.subscribe('league-1', 'user-1', listener)

    const state = {
      leagueId: 'league-1',
      userId: 'user-1',
      rosterId: 'roster-1',
      leagueName: 'League One',
      sport: 'NFL',
      sessionId: 'session-1',
      status: 'active',
      trigger: 'pick_update',
      currentOverall: 10,
      userNextOverall: 15,
      picksUntilUser: 5,
      generatedAt: '2026-03-30T00:00:00.000Z',
      updatedAt: '2026-03-30T00:00:00.000Z',
      headline: 'Queue ready',
      queue: [],
      predictions: [],
      messages: {
        ready: 'ready',
        update: 'update',
        onClock: 'on clock',
      },
      recap: null,
      archived: false,
    } as const

    draftIntelStateStore.set('queue_update', state as any)

    expect(draftIntelStateStore.get('league-1', 'user-1')?.headline).toBe('Queue ready')
    expect(listener).toHaveBeenCalledWith({
      type: 'queue_update',
      leagueId: 'league-1',
      userId: 'user-1',
      state,
    })

    unsubscribe()
  })

  it('drops states not written for six hours, but never one with a live subscriber', () => {
    vi.useFakeTimers()
    try {
      const make = (leagueId: string) => ({ leagueId, userId: 'u', headline: leagueId }) as any
      const unsubscribe = draftIntelStateStore.subscribe('open-room', 'u', () => {})
      draftIntelStateStore.set('queue_update', make('finished'))
      draftIntelStateStore.set('queue_update', make('open-room'))
      vi.advanceTimersByTime(6 * 60 * 60 * 1000 + 1)
      draftIntelStateStore.set('queue_update', make('fresh'))

      expect(draftIntelStateStore.get('finished', 'u')).toBeNull()
      expect(draftIntelStateStore.get('open-room', 'u')?.headline).toBe('open-room')
      expect(draftIntelStateStore.get('fresh', 'u')?.headline).toBe('fresh')
      unsubscribe()
    } finally {
      vi.useRealTimers()
    }
  })

  it('caps the number of states, dropping the oldest write first', () => {
    const make = (leagueId: string) => ({ leagueId, userId: 'cap', headline: leagueId }) as any
    for (let i = 0; i <= 2000; i++) draftIntelStateStore.set('queue_update', make(`cap-${i}`))

    expect(draftIntelStateStore.get('cap-0', 'cap')).toBeNull()
    expect(draftIntelStateStore.get('cap-2000', 'cap')?.headline).toBe('cap-2000')
  })
})
