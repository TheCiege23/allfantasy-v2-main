/**
 * Who is in the draft room (lib/draft-room/draftPresence.ts + the board's header dot).
 * Yahoo 2026: "I couldn't tell who was in the draft. No logo change or icon change when they were
 * in. Or out." Presence had been hard-coded to 0 since Supabase was removed.
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/queues/bullmq', () => ({ getRedisClient: () => null }))
vi.mock('@/components/app/draft-room/LazyDraftImage', () => ({ LazyDraftImage: () => null }))

import {
  PRESENCE_TTL_MS,
  memoryPresenceStore,
  redisPresenceStore,
  touchAndListDraftPresence,
  viewerRosterIdsCached,
} from '@/lib/draft-room/draftPresence'
import { DraftBoard } from '@/components/app/draft-room/DraftBoard'

/** A sorted-set double with Redis's semantics for the four commands the store uses. */
function fakeRedis() {
  const sets = new Map<string, Map<string, number>>()
  const num = (v: number | string) => (v === '-inf' ? -Infinity : v === '+inf' ? Infinity : Number(v))
  return {
    sets,
    async zadd(k: string, score: number, m: string) {
      const z = sets.get(k) ?? new Map()
      z.set(m, score)
      sets.set(k, z)
    },
    async zremrangebyscore(k: string, min: number | string, max: number | string) {
      const z = sets.get(k)
      if (!z) return
      for (const [m, sc] of z) if (sc >= num(min) && sc <= num(max)) z.delete(m)
    },
    async zrangebyscore(k: string, min: number | string, max: number | string) {
      return [...(sets.get(k) ?? new Map<string, number>())].filter(([, sc]) => sc >= num(min) && sc <= num(max)).map(([m]) => m)
    },
    async pexpire() {},
  }
}

describe.each([
  ['memory', () => memoryPresenceStore()],
  ['redis', () => redisPresenceStore(fakeRedis())],
])('%s presence store', (_name, make) => {
  it('a roster seen within the window is in the room; one that stopped polling drops out', async () => {
    const s = make()
    const t0 = 1_000_000
    await s.touch('lg', 'r1', t0)
    await s.touch('lg', 'r2', t0 + 10_000)
    expect(await s.online('lg', t0 + 20_000)).toEqual(['r1', 'r2'])
    // r1's tab closed; r2 keeps polling.
    await s.touch('lg', 'r2', t0 + PRESENCE_TTL_MS)
    expect(await s.online('lg', t0 + PRESENCE_TTL_MS + 1)).toEqual(['r2'])
    // Leagues do not share a room.
    expect(await s.online('other', t0 + 20_000)).toEqual([])
  })
})

describe('touchAndListDraftPresence', () => {
  it('marks every team the viewer holds, and a spectator (no team) only reads', async () => {
    const s = memoryPresenceStore()
    expect(await touchAndListDraftPresence('lg', ['r1', 'r4'], 5_000, s)).toEqual(['r1', 'r4'])
    expect(await touchAndListDraftPresence('lg', [], 6_000, s)).toEqual(['r1', 'r4'])
  })

  it('a failing store never fails the poll: it answers from memory', async () => {
    const broken = { touch: async () => { throw new Error('down') }, online: async () => [] }
    expect(await touchAndListDraftPresence('lg-x', ['r9'], 7_000, broken)).toEqual(['r9'])
  })

  it('rosters are looked up once per two minutes per viewer, not on every 2s poll', async () => {
    const load = vi.fn(async () => ['r1'])
    await viewerRosterIdsCached('lg', 'u1', load, 0)
    await viewerRosterIdsCached('lg', 'u1', load, 60_000)
    expect(load).toHaveBeenCalledTimes(1)
    await viewerRosterIdsCached('lg', 'u1', load, 121_000)
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('board header: who is in the room', () => {
  beforeEach(() => vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))))
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('a dot, with words for screen readers, on exactly the teams whose manager is here', () => {
    render(
      <DraftBoard
        picks={[]}
        slotOrder={[1, 2, 3].map((slot) => ({ slot, rosterId: `r-${slot}`, displayName: `Team ${slot}` }))}
        teamCount={3}
        rounds={1}
        draftType="snake"
        thirdRoundReversal={false}
        onlineRosterIds={['r-1', 'r-3']}
      />,
    )
    expect(screen.getByTestId('draft-board-team-header-online-1').getAttribute('title')).toBe('In the draft room')
    expect(screen.queryByTestId('draft-board-team-header-online-2')).toBeNull()
    expect(screen.getByTestId('draft-board-team-header-online-3')).toBeTruthy()
    expect(screen.getByTestId('draft-board-team-header-slot-1').textContent).toContain('in the draft room')
    expect(screen.getByTestId('draft-board-team-header-slot-2').textContent).not.toContain('in the draft room')
  })
})
