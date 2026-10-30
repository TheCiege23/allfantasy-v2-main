/** Native Lineup screen offline: the copy saved on the last online load is shown read-only. */
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserLeague } from '@/app/dashboard/types'

vi.mock('@/hooks/useLeagueRealtimeRefresh', () => ({ useLeagueRealtimeRefresh: () => undefined }))
vi.mock('@/lib/league/lineup-lock', () => ({ evaluateLineupLock: () => ({ locked: false, policy: 'football_weekly' }) }))
vi.mock('@/lib/dashboard/intelligence-events', () => ({ invalidateIntelligence: () => undefined }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }) }))

import { NativeLineupScreen } from '@/components/league/native/screens/NativeLineupScreen'
import { OFFLINE_LINEUP_CACHE, offlineLineupKey } from '@/lib/pwa/offlineLineupSnapshots'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const league = { id: 'lg1', name: 'Blah', sport: 'NFL', season: 2026, currentWeek: 5, teamCount: 12, platform: 'allfantasy', format: 'redraft', settings: {} } as unknown as UserLeague
const team = { id: 't', teamName: "TheCiege26's Team", wins: 3, losses: 1, ties: 0, pointsFor: 478.6, currentRank: 2 } as never

const wire = (id: string, name: string, position: string) => ({
  id, name, position, team: 'PHI', sport: 'NFL', headshotUrl: null, imageUrl: null, teamLogoUrl: null, injuryStatus: null,
  fantasyPointsPerGame: null, projectedPoints: 10, adp: null, aiAdp: null, aiAdpSampleSize: null, collegeClass: '', collegeClassLabel: null,
  soccerLeague: null, nflRookieIsRookie: null, nflRookieSource: null, lowConfidence: false, profileSource: null, statsSource: null,
  projectionsSource: null, normalizedStats: {}, normalizedProjections: {}, product: { unified: {}, yearsExp: null },
})
const rosterRoute = {
  rosterId: 'ros1', leagueWeek: 5, canEditLineup: true, lineupLockHelp: 'Each game locks at kickoff.',
  starterSlots: [
    { index: 0, label: 'QB', allowedPositions: ['QB'], isFlexible: false },
    { index: 1, label: 'RB', allowedPositions: ['RB'], isFlexible: false },
  ],
  roster: { lineup_sections: { starters: [{ id: 'qb1' }, { id: 'rb1' }], bench: [{ id: 'rb2' }], ir: [], taxi: [], devy: [] } },
  unifiedRoster: [wire('qb1', 'Jalen Hurts', 'QB'), wire('rb1', 'Tyjae Spears', 'RB'), wire('rb2', 'Bijan Robinson', 'RB')],
}

function onlineFetch() {
  return vi.fn(async (url: string) => {
    if (url.includes('/api/league/roster')) return new Response(JSON.stringify(rosterRoute), { status: 200 })
    return new Response(JSON.stringify({}), { status: 200 })
  })
}
const offlineFetch = () => vi.fn(async () => { throw new TypeError('Failed to fetch') })

function cacheStorage() {
  const stores = new Map<string, Map<string, Response>>()
  return {
    stores,
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map())
      const s = stores.get(name)!
      return {
        put: async (k: string, v: Response) => void s.set(k, v),
        match: async (k: string) => s.get(k)?.clone(),
      }
    },
  }
}

describe('NativeLineupScreen offline', () => {
  it('saves the live lineup online, shows it read-only offline, and goes live again on reconnect', async () => {
    const caches = cacheStorage()
    vi.stubGlobal('caches', caches)
    vi.stubGlobal('fetch', onlineFetch())

    const first = render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    await screen.findByText('Jalen Hurts')
    await waitFor(() => expect(caches.stores.get(OFFLINE_LINEUP_CACHE)?.has(offlineLineupKey('lg1'))).toBe(true))
    const saved = await caches.stores.get(OFFLINE_LINEUP_CACHE)!.get(offlineLineupKey('lg1'))!.clone().json()
    expect(saved.starters.map((r: { name: string }) => r.name)).toEqual(['Jalen Hurts', 'Tyjae Spears'])
    expect(saved.bench.map((r: { name: string }) => r.name)).toEqual(['Bijan Robinson'])
    first.unmount()

    // A fresh mount with no network: the saved copy, not an error.
    vi.stubGlobal('fetch', offlineFetch())
    render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    const view = await screen.findByTestId('offline-lineup-snapshot')
    expect(view.textContent).toContain('Jalen Hurts')
    expect(view.textContent).toContain('Bijan Robinson')
    expect(view.textContent).toContain('changes are off until you reconnect')
    expect(screen.queryByText('We could not load your roster.')).toBeNull()
    expect(screen.queryAllByTestId('lineup-tap')).toHaveLength(0)
    expect((screen.getByRole('button', { name: 'Optimize lineup' }) as HTMLButtonElement).disabled).toBe(true)

    // Reconnect: the screen reloads by itself and the live, editable lineup replaces the copy.
    vi.stubGlobal('fetch', onlineFetch())
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(screen.queryByTestId('offline-lineup-snapshot')).toBeNull())
    expect(screen.getAllByTestId('lineup-tap').length).toBeGreaterThan(0)
  })

  it('with nothing saved, offline is still the plain load error', async () => {
    vi.stubGlobal('caches', cacheStorage())
    vi.stubGlobal('fetch', offlineFetch())
    render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    expect(await screen.findByText('We could not load your roster.')).toBeTruthy()
    expect(screen.queryByTestId('offline-lineup-snapshot')).toBeNull()
  })
})
