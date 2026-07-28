// @vitest-environment node
/**
 * Decision OS structured action propagation: a surface carrying only the AF `League.id` resolves the
 * correct source-platform link via a DB lookup — with NO provider fetch during resolution.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ findUnique: vi.fn(), findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: h.findUnique, findMany: h.findMany } } }))

import {
  resolveSourceLinkForLeague,
  resolveSourceLinksForLeagueIds,
} from '@/lib/league-links/resolveSourceLinkForLeague'

beforeEach(() => vi.clearAllMocks())

describe('resolveSourceLinkForLeague', () => {
  it('resolves a Sleeper source link from an AF League.id, with an action label and NO provider fetch', async () => {
    h.findUnique.mockResolvedValue({ platform: 'sleeper', platformLeagueId: '131353', name: 'HailShiva', season: 2026 })
    const spy = vi.spyOn(globalThis, 'fetch' as never)
    const link = await resolveSourceLinkForLeague('L1', 'lineup')
    expect(link?.href).toBe('https://sleeper.com/leagues/131353/league')
    expect(link?.label).toBe('Fix Lineup in HailShiva')
    expect(link?.isFallback).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })

  it('returns null for a native league and for a missing league', async () => {
    h.findUnique.mockResolvedValueOnce({ platform: 'allfantasy', platformLeagueId: null, name: 'X', season: 2026 })
    expect(await resolveSourceLinkForLeague('native')).toBeNull()
    h.findUnique.mockResolvedValueOnce(null)
    expect(await resolveSourceLinkForLeague('missing')).toBeNull()
  })

  it('batch-resolves many league ids in ONE query, skipping native leagues', async () => {
    h.findMany.mockResolvedValue([
      { id: 'A', platform: 'sleeper', platformLeagueId: '111', name: 'A', season: 2026 },
      { id: 'B', platform: 'espn', platformLeagueId: '222', name: 'B', season: 2026 },
      { id: 'C', platform: 'allfantasy', platformLeagueId: null, name: 'C', season: 2026 },
    ])
    const map = await resolveSourceLinksForLeagueIds(['A', 'B', 'C', 'A'], 'waiver')
    expect(h.findMany).toHaveBeenCalledTimes(1)
    expect(map.get('A')?.href).toBe('https://sleeper.com/leagues/111/league')
    expect(map.get('A')?.label).toBe('Manage Waivers in A')
    expect(map.get('B')?.href).toBe('https://fantasy.espn.com/football/league?leagueId=222&seasonId=2026')
    expect(map.has('C')).toBe(false)
  })
})
