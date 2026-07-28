// @vitest-environment node
/**
 * buildLeagueActionBundles — the per-league action bundle shared by Pending Trades, Waiver
 * Recommendations, and per-league lineup blocks. External link resolved SERVER-SIDE from the canonical
 * League (one query), honest homepage fallback label, unknown/native → no external, missing → fail-safe,
 * cross-league isolation, no provider fetch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findMany: h.findMany } } }))

import { buildLeagueActionBundles } from '@/lib/league-links/enrichDecisionOsActions'

const TRADE = { action: 'trade' as const, internalLabel: 'Analyze Trade in AF', internalTab: 'trades', externalLabel: (n: string) => `Review Trade in ${n}` }
const WAIVER = { action: 'waiver' as const, internalLabel: 'Analyze Waivers in AF', internalTab: 'players', externalLabel: (n: string) => `Manage Waivers in ${n}` }
const league = (over: Record<string, unknown> = {}) => ({
  id: 'L1', platform: 'sleeper', platformLeagueId: '131353', name: 'HailShiva', season: 2026,
  lastSyncedAt: new Date('2026-07-28T12:00:00.000Z'), ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('buildLeagueActionBundles', () => {
  it('Sleeper trade → direct URL + "Review Trade" + internal "Analyze Trade in AF" + freshness', async () => {
    h.findMany.mockResolvedValue([league()])
    const b = (await buildLeagueActionBundles([{ leagueId: 'L1' }], TRADE)).get('L1')!
    expect(b.external?.link.href).toBe('https://sleeper.com/leagues/131353/league')
    expect(b.external?.label).toBe('Review Trade in HailShiva')
    expect(b.internal).toEqual({ href: '/league/L1?tab=trades', label: 'Analyze Trade in AF' })
    expect(b.imported).toBe(true)
    expect(b.dataAsOf).toBe('2026-07-28T12:00:00.000Z')
  })

  it('ESPN waiver → ESPN URL + "Manage Waivers" + players tab', async () => {
    h.findMany.mockResolvedValue([league({ platform: 'espn', platformLeagueId: '42654852' })])
    const b = (await buildLeagueActionBundles([{ leagueId: 'L1' }], WAIVER)).get('L1')!
    expect(b.external?.link.href).toBe('https://fantasy.espn.com/football/league?leagueId=42654852&seasonId=2026')
    expect(b.external?.label).toBe('Manage Waivers in HailShiva')
    expect(b.internal?.href).toBe('/league/L1?tab=players')
  })

  it('Yahoo trade → Yahoo f1 URL', async () => {
    h.findMany.mockResolvedValue([league({ platform: 'yahoo', platformLeagueId: '12798' })])
    const b = (await buildLeagueActionBundles([{ leagueId: 'L1' }], TRADE)).get('L1')!
    expect(b.external?.link.href).toBe('https://football.fantasysports.yahoo.com/f1/12798')
  })

  it('MFL/Fantrax/Fleaflicker → honest homepage fallback label (never "Review Trade")', async () => {
    const cases: Array<[string, string, string]> = [
      ['mfl', 'https://www.myfantasyleague.com', 'Go to MyFantasyLeague'],
      ['fantrax', 'https://www.fantrax.com', 'Go to Fantrax'],
      ['fleaflicker', 'https://www.fleaflicker.com', 'Go to Fleaflicker'],
    ]
    for (const [platform, home, honestLabel] of cases) {
      h.findMany.mockResolvedValue([league({ platform, platformLeagueId: '9' })])
      const b = (await buildLeagueActionBundles([{ leagueId: 'L1' }], TRADE)).get('L1')!
      expect(b.external?.link.href).toBe(home)
      expect(b.external?.link.isFallback).toBe(true)
      expect(b.external?.label).toBe(honestLabel) // honest — not "Review Trade in ..."
    }
  })

  it('unknown / native platform → NO external action; internal still offered', async () => {
    h.findMany.mockResolvedValue([league({ platform: 'allfantasy', platformLeagueId: null })])
    const b = (await buildLeagueActionBundles([{ leagueId: 'L1' }], TRADE)).get('L1')!
    expect(b.external).toBeNull()
    expect(b.imported).toBe(false)
    expect(b.internal?.label).toBe('Analyze Trade in AF')
  })

  it('missing canonical league → fails safe (internal only, not imported)', async () => {
    h.findMany.mockResolvedValue([])
    const b = (await buildLeagueActionBundles([{ leagueId: 'GONE', leagueName: 'X' }], TRADE)).get('GONE')!
    expect(b.external).toBeNull()
    expect(b.imported).toBe(false)
    expect(b.internal?.href).toBe('/league/GONE?tab=trades')
  })

  it('cross-league isolation — ONE query, each league keyed to its own URL', async () => {
    h.findMany.mockResolvedValue([
      { id: 'A', platform: 'sleeper', platformLeagueId: '111', name: 'A', season: 2026, lastSyncedAt: null },
      { id: 'B', platform: 'espn', platformLeagueId: '222', name: 'B', season: 2026, lastSyncedAt: null },
    ])
    const map = await buildLeagueActionBundles([{ leagueId: 'A' }, { leagueId: 'B' }], TRADE)
    expect(h.findMany).toHaveBeenCalledTimes(1)
    expect(map.get('A')?.external?.link.href).toBe('https://sleeper.com/leagues/111/league')
    expect(map.get('B')?.external?.link.href).toBe('https://fantasy.espn.com/football/league?leagueId=222&seasonId=2026')
  })

  it('never fetches a provider', async () => {
    h.findMany.mockResolvedValue([league()])
    const spy = vi.spyOn(globalThis, 'fetch' as never)
    await buildLeagueActionBundles([{ leagueId: 'L1' }], TRADE)
    expect(spy).not.toHaveBeenCalled()
  })

  it('empty input → no DB query', async () => {
    const map = await buildLeagueActionBundles([], TRADE)
    expect(map.size).toBe(0)
    expect(h.findMany).not.toHaveBeenCalled()
  })
})
