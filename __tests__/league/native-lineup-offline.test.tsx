/** Native Lineup screen offline: the roster kept on the last online load opens, edits are kept and sent on reconnect. */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserLeague } from '@/app/dashboard/types'

vi.mock('@/hooks/useLeagueRealtimeRefresh', () => ({ useLeagueRealtimeRefresh: () => undefined }))
vi.mock('@/lib/league/lineup-lock', () => ({ evaluateLineupLock: () => ({ locked: false, policy: 'football_weekly' }) }))
vi.mock('@/lib/dashboard/intelligence-events', () => ({ invalidateIntelligence: () => undefined }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: toasts.success, error: toasts.error, message: vi.fn() }) }))

import { NativeLineupScreen } from '@/components/league/native/screens/NativeLineupScreen'
import { OfflineLineupSync } from '@/components/pwa/OfflineLineupSync'
import { OFFLINE_LINEUP_CACHE, offlineLineupKey, saveOfflineLineupSnapshot, type OfflineLineupSnapshot } from '@/lib/pwa/offlineLineupSnapshots'
import { OFFLINE_LINEUP_QUEUE_PREFIX, OFFLINE_ROSTER_DATA_PREFIX, readQueuedLineupEdit } from '@/lib/pwa/offlineLineupQueue'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  toasts.success.mockReset()
  toasts.error.mockReset()
})

const league = { id: 'lg1', name: 'Blah', sport: 'NFL', season: 2026, currentWeek: 5, teamCount: 12, platform: 'allfantasy', format: 'redraft', settings: {} } as unknown as UserLeague
const team = { id: 't', teamName: "TheCiege26's Team", wins: 3, losses: 1, ties: 0, pointsFor: 478.6, currentRank: 2 } as never

const wire = (id: string, name: string, position: string) => ({
  id, name, position, team: 'PHI', sport: 'NFL', headshotUrl: null, imageUrl: null, teamLogoUrl: null, injuryStatus: null,
  fantasyPointsPerGame: null, projectedPoints: 10, adp: null, aiAdp: null, aiAdpSampleSize: null, collegeClass: '', collegeClassLabel: null,
  soccerLeague: null, nflRookieIsRookie: null, nflRookieSource: null, lowConfidence: false, profileSource: null, statsSource: null,
  projectionsSource: null, normalizedStats: {}, normalizedProjections: {}, product: { unified: {}, yearsExp: null },
})
const rosterRoute = (lineupVersion: string, starters = ['qb1', 'rb1'], bench = ['rb2']) => ({
  rosterId: 'ros1', lineupVersion, leagueWeek: 5, canEditLineup: true, lineupLockHelp: 'Each game locks at kickoff.',
  starterSlots: [
    { index: 0, label: 'QB', allowedPositions: ['QB'], isFlexible: false },
    { index: 1, label: 'RB', allowedPositions: ['RB'], isFlexible: false },
  ],
  roster: { lineup_sections: { starters: starters.map((id) => ({ id })), bench: bench.map((id) => ({ id })), ir: [], taxi: [], devy: [] } },
  unifiedRoster: [wire('qb1', 'Jalen Hurts', 'QB'), wire('rb1', 'Tyjae Spears', 'RB'), wire('rb2', 'Bijan Robinson', 'RB')],
})

type Call = { url: string; body: any }
function server(route: () => unknown, save: (body: any) => { status: number; json: unknown } = () => ({ status: 200, json: { ok: true, lineupVersion: 'ver-2' } })) {
  const calls: Call[] = []
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ url, body })
    if (url.includes('/api/league/roster')) return new Response(JSON.stringify(route()), { status: 200 })
    if (url === '/api/leagues/roster/save') {
      const r = save(body)
      return new Response(JSON.stringify(r.json), { status: r.status })
    }
    return new Response(JSON.stringify({}), { status: 200 })
  })
  return { fn, calls, saves: () => calls.filter((c) => c.url === '/api/leagues/roster/save') }
}
const noNetwork = () => vi.fn(async (_url?: string) => { throw new TypeError('Failed to fetch') })

function cacheStorage() {
  const stores = new Map<string, Map<string, Response>>()
  const keyOf = (k: Request | string) => (typeof k === 'string' ? k : new URL(k.url).pathname)
  return {
    stores,
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map())
      const s = stores.get(name)!
      return {
        put: async (k: Request | string, v: Response) => void s.set(keyOf(k), v),
        match: async (k: Request | string) => s.get(keyOf(k))?.clone(),
        delete: async (k: Request | string) => s.delete(keyOf(k)),
        keys: async () => [...s.keys()].map((p) => new Request(`https://www.allfantasy.ai${p}`)),
      }
    },
  }
}
const keysIn = (c: ReturnType<typeof cacheStorage>) => [...(c.stores.get(OFFLINE_LINEUP_CACHE)?.keys() ?? [])]

const benchBijanForTyjae = () => {
  fireEvent.click(screen.getAllByRole('button', { name: 'Move' }).at(-1)!)
  fireEvent.click(screen.getByText('Replace Tyjae Spears'))
}

describe('NativeLineupScreen offline', () => {
  it('opens the full editor offline, keeps a change on the device, and sends it on reconnect', async () => {
    const caches = cacheStorage()
    vi.stubGlobal('caches', caches)
    vi.stubGlobal('fetch', server(() => rosterRoute('ver-1')).fn)

    const first = render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    await screen.findByText('Jalen Hurts')
    await waitFor(() => expect(keysIn(caches)).toEqual(expect.arrayContaining([offlineLineupKey('lg1'), `${OFFLINE_ROSTER_DATA_PREFIX}lg1`])))
    first.unmount()

    // No network: the editor itself, not the read-only copy.
    const offline = noNetwork()
    vi.stubGlobal('fetch', offline)
    render(<><OfflineLineupSync /><NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} /></>)
    expect((await screen.findByTestId('lineup-offline')).textContent).toContain('saved on this device')
    expect(screen.queryByTestId('offline-lineup-snapshot')).toBeNull()

    benchBijanForTyjae()
    await screen.findByTestId('lineup-pending-sync')
    // Kept, not sent: nothing tried to reach the save route.
    expect(offline.mock.calls.some(([u]) => u === '/api/leagues/roster/save')).toBe(false)
    const queued = await readQueuedLineupEdit('lg1')
    expect(queued?.baseVersion).toBe('ver-1')
    expect(queued?.lists.starters).toEqual(['qb1', 'rb2'])
    expect(toasts.success).toHaveBeenCalledWith('Saved on this device', expect.anything())

    // Reconnect: the change is sent once, built on the version it was made on, and the screen goes live.
    const online = server(() => rosterRoute('ver-2', ['qb1', 'rb2'], ['rb1']))
    vi.stubGlobal('fetch', online.fn)
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(screen.queryByTestId('lineup-pending-sync')).toBeNull())
    await waitFor(() => expect(screen.queryByTestId('lineup-offline')).toBeNull())
    expect(online.saves()).toHaveLength(1)
    expect(online.saves()[0].body).toMatchObject({ leagueId: 'lg1', rosterId: 'ros1', week: 5, expectedLineupVersion: 'ver-1' })
    expect(online.saves()[0].body.roster.starters.map((r: { id: string }) => r.id)).toEqual(['qb1', 'rb2'])
    expect(await readQueuedLineupEdit('lg1')).toBeNull()
    expect(keysIn(caches).some((k) => k.startsWith(OFFLINE_LINEUP_QUEUE_PREFIX))).toBe(false)
    expect(toasts.success).toHaveBeenCalledWith('Lineup changes you made offline are saved.')
  })

  it('a change the server refuses on reconnect is dropped, said so, and the live lineup shown', async () => {
    const caches = cacheStorage()
    vi.stubGlobal('caches', caches)
    vi.stubGlobal('fetch', server(() => rosterRoute('ver-1')).fn)
    const first = render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    await screen.findByText('Jalen Hurts')
    await waitFor(() => expect(keysIn(caches)).toContain(`${OFFLINE_ROSTER_DATA_PREFIX}lg1`))
    first.unmount()

    vi.stubGlobal('fetch', noNetwork())
    render(<><OfflineLineupSync /><NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} /></>)
    await screen.findByTestId('lineup-offline')
    benchBijanForTyjae()
    await screen.findByTestId('lineup-pending-sync')

    const online = server(
      () => rosterRoute('ver-9'),
      () => ({ status: 403, json: { error: "That player's game has started, so their lineup position is locked." } }),
    )
    vi.stubGlobal('fetch', online.fn)
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Lineup changes you made offline were not saved.', { description: "That player's game has started, so their lineup position is locked." }))
    await waitFor(() => expect(screen.queryByTestId('lineup-pending-sync')).toBeNull())
    expect(await readQueuedLineupEdit('lg1')).toBeNull()
    expect(online.saves()).toHaveLength(1)
  })

  it('online, a save sends the loaded version and builds the next move on the one returned', async () => {
    vi.stubGlobal('caches', cacheStorage())
    const s = server(() => rosterRoute('ver-1'))
    vi.stubGlobal('fetch', s.fn)
    render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    await screen.findByText('Jalen Hurts')
    benchBijanForTyjae()
    await waitFor(() => expect(s.saves()).toHaveLength(1))
    expect(s.saves()[0].body.expectedLineupVersion).toBe('ver-1')
    expect(screen.queryByTestId('lineup-pending-sync')).toBeNull()
  })

  it('without the editor copy, offline falls back to the read-only snapshot', async () => {
    const caches = cacheStorage()
    vi.stubGlobal('caches', caches)
    const snap: OfflineLineupSnapshot = {
      v: 1, leagueId: 'lg1', leagueName: 'Blah', sport: 'NFL', teamName: 'T', week: 5, savedAt: '2026-10-30T17:00:00.000Z',
      starters: [{ slot: 'QB', name: 'Jalen Hurts', position: 'QB', team: 'PHI', game: null, injury: null }], bench: [], ir: [], taxi: [],
    }
    await saveOfflineLineupSnapshot(snap)
    vi.stubGlobal('fetch', noNetwork())
    render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    expect((await screen.findByTestId('offline-lineup-snapshot')).textContent).toContain('Jalen Hurts')
    expect(screen.queryAllByTestId('lineup-tap')).toHaveLength(0)
  })

  it('with nothing saved, offline is still the plain load error', async () => {
    vi.stubGlobal('caches', cacheStorage())
    vi.stubGlobal('fetch', noNetwork())
    render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    expect(await screen.findByText('We could not load your roster.')).toBeTruthy()
    expect(screen.queryByTestId('offline-lineup-snapshot')).toBeNull()
  })
})
