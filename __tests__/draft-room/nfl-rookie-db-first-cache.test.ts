import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  flags: { useDbCacheOnly: false, disableLiveApiOnPageLoad: false },
  cached: vi.fn(),
  save: vi.fn(),
  players: vi.fn(),
}))
vi.mock('@/lib/db-first-mode', () => ({ dbFirstMode: h.flags }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsDataCache: { findUnique: h.cached, upsert: h.save } } }))
vi.mock('@/lib/sleeper-client', () => ({ getAllPlayers: h.players }))

import { loadNflRookieLookup } from '@/lib/draft-room/nflRookieLookup'

beforeEach(() => {
  vi.clearAllMocks()
  h.flags.useDbCacheOnly = false
  h.flags.disableLiveApiOnPageLoad = false
  h.cached.mockResolvedValue({
    expiresAt: new Date(Date.now() + 60_000),
    data: { v: 1, bySleeperId: { '123': 0 }, byNamePos: { 'test rookie|QB': 0 }, byName: { 'test rookie': 0 } },
  })
  h.players.mockResolvedValue({})
  h.save.mockResolvedValue({})
})

describe('NFL rookie lookup respects DB-first draft loading', () => {
  it.each(['useDbCacheOnly', 'disableLiveApiOnPageLoad'] as const)(
    'uses stored rookie metadata when %s is enabled',
    async flag => {
      h.flags[flag] = true
      const result = await loadNflRookieLookup()
      expect(result.fetchSource).toBe('sportsdatacache_compact')
      expect(result.lookup.bySleeperId.get('123')?.yearsExp).toBe(0)
      expect(h.players).not.toHaveBeenCalled()
      expect(h.save).not.toHaveBeenCalled()
    },
  )

  it('keeps expired metadata unknown without a live fetch', async () => {
    h.flags.useDbCacheOnly = true
    h.cached.mockResolvedValue({ expiresAt: new Date(0), data: { v: 1, bySleeperId: { '123': 0 } } })
    const result = await loadNflRookieLookup()
    expect(result.lookup.hasData).toBe(false)
    expect(result.lookup.bySleeperId.size).toBe(0)
    expect(h.players).not.toHaveBeenCalled()
    expect(h.save).not.toHaveBeenCalled()
  })

  it('retains the permitted live lookup and compact-cache refresh when flags are off', async () => {
    h.players.mockResolvedValue({
      '123': { player_id: '123', full_name: 'Test Rookie', position: 'QB', years_exp: 0 },
    })
    const result = await loadNflRookieLookup()
    expect(result.fetchSource).toBe('sleeper_live')
    expect(result.lookup.bySleeperId.get('123')?.yearsExp).toBe(0)
    expect(h.players).toHaveBeenCalledOnce()
    expect(h.save).toHaveBeenCalledOnce()
  })
})
