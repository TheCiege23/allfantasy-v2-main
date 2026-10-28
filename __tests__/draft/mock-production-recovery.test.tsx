import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MockDraftSleeperRoomClient from '@/components/mock-draft/MockDraftSleeperRoomClient'

const key = 'af:mock-draft:v1:viewer:open'
function checkpoint(overrides: Record<string, unknown> = {}) {
  return {
    version: 1, mode: 'open', queue: [] as string[], draftId: null, shareId: null,
    state: {
      settings: { teamCount: 2, rounds: 2, draftType: 'snake', sport: 'NBA', scoring: 'Points', superflex: false, myPickSlot: 1, speed: 15 },
      teams: [1, 2].map(slot => ({ slot, managerId: String(slot), managerName: `Manager ${slot}`, avatarUrl: null, isUser: slot === 1, isAI: slot !== 1, role: 'member', isOrphan: false, picks: [], rosterNeeds: [] })),
      availablePlayers: ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((name, index) => ({ id: name, name, position: 'PG', team: 'LAL', adp: index + 1, projectedPts: 80, ownership: 10, injuryStatus: null, tier: 1, posRank: 'PG1', isRookie: false })),
      picks: [], currentPick: 1, onTheClock: 1, status: 'paused', timerSeconds: 15, pausedRemainingMs: 15000, turnDeadlineMs: null, chatMessages: [],
      ...overrides,
    },
  }
}
function saved() { return JSON.parse(localStorage.getItem(key)!) }
async function openPlayers() {
  // The mobile tray is the same production component mounted alongside desktop content. It is a
  // non-modal region (the board stays usable behind it), not a dialog.
  fireEvent.click(screen.getByRole('button', { name: 'Players', exact: true }))
  return within(screen.getByRole('region', { name: 'Players', exact: true }))
}
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ leagues: [] }), { status: 200 })))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('production mock mobile recovery and clocks', () => {
  it('queues off-turn with a visible button, survives remount, and keeps the draft paused', async () => {
    localStorage.setItem(key, JSON.stringify(checkpoint({ onTheClock: 2, currentPick: 2 })))
    const view = render(<MockDraftSleeperRoomClient viewerId="viewer" />)
    await screen.findByText(/Recovered your mock draft/)
    const drawer = await openPlayers()
    fireEvent.click(drawer.getByRole('button', { name: 'Queue Bravo', exact: true }))
    await waitFor(() => expect(saved().queue).toEqual(['Bravo']))
    expect(saved().state.picks).toEqual([])
    view.unmount()
    render(<MockDraftSleeperRoomClient viewerId="viewer" />)
    await screen.findByText(/Recovered your mock draft/)
    expect(saved().queue).toEqual(['Bravo'])
    expect(screen.getByTestId('mock-draft-resume')).toBeDefined()
    expect(saved().state.currentPick).toBe(2)
  })

  it('persists a manual pick and restores it after remount', async () => {
    localStorage.setItem(key, JSON.stringify(checkpoint()))
    const view = render(<MockDraftSleeperRoomClient viewerId="viewer" />)
    await screen.findByTestId('mock-draft-resume')
    fireEvent.click(screen.getByTestId('mock-draft-resume'))
    const drawer = await openPlayers()
    fireEvent.click(drawer.getByTestId('mock-draft-player-row-Alpha'))
    await waitFor(() => expect(saved().state.picks).toHaveLength(1))
    view.unmount()
    render(<MockDraftSleeperRoomClient viewerId="viewer" />)
    await screen.findByTestId('mock-draft-resume')
    expect(saved().state.picks[0].playerId).toBe('Alpha')
    expect(saved().state.currentPick).toBe(2)
  })

  it('removes drafted queue entries so the remaining players can be reordered', async () => {
    const value = checkpoint(); value.queue = ['Alpha', 'Bravo', 'Charlie']
    localStorage.setItem(key, JSON.stringify(value))
    render(<MockDraftSleeperRoomClient viewerId="viewer" />)
    await screen.findByTestId('mock-draft-resume')
    fireEvent.click(screen.getByTestId('mock-draft-resume'))
    const drawer = await openPlayers()
    fireEvent.click(drawer.getByTestId('mock-draft-player-row-Alpha'))
    fireEvent.click(screen.getByTestId('mock-draft-pause'))
    await waitFor(() => expect(saved().queue).toEqual(['Bravo', 'Charlie']))
    fireEvent.click(within(drawer.getByTestId('mock-draft-queue-entry-Bravo')).getByRole('button', { name: 'Down', exact: true }))
    await waitFor(() => expect(saved().queue).toEqual(['Charlie', 'Bravo']))
  })

  it('expires from elapsed time on foregrounding and uses the queue exactly once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const value = checkpoint(); value.queue = ['Bravo']
    localStorage.setItem(key, JSON.stringify(value))
    render(<MockDraftSleeperRoomClient viewerId="viewer" />)
    await screen.findByTestId('mock-draft-resume')
    fireEvent.click(screen.getByTestId('mock-draft-resume'))
    act(() => { vi.setSystemTime(Date.now() + 30000); document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(saved().state.picks).toHaveLength(1))
    expect(saved().state.picks[0].playerId).toBe('Bravo')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(saved().state.picks).toHaveLength(1)
  })

  it('pause/resume preserves the unspent part of a turn', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    localStorage.setItem(key, JSON.stringify(checkpoint()))
    render(<MockDraftSleeperRoomClient viewerId="viewer" />)
    await screen.findByTestId('mock-draft-resume')
    fireEvent.click(screen.getByTestId('mock-draft-resume'))
    act(() => vi.setSystemTime(Date.now() + 7000))
    fireEvent.click(screen.getByTestId('mock-draft-pause'))
    expect(saved().state.pausedRemainingMs).toBe(8000)
    act(() => vi.setSystemTime(Date.now() + 60000))
    fireEvent.click(screen.getByTestId('mock-draft-resume'))
    expect(saved().state.turnDeadlineMs - Date.now()).toBe(8000)
  })

  it('reconciles an overdue CPU turn once on foregrounding', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    localStorage.setItem(key, JSON.stringify(checkpoint({ onTheClock: 2, currentPick: 2, pausedRemainingMs: 3000 })))
    render(<MockDraftSleeperRoomClient viewerId="viewer" />)
    await screen.findByTestId('mock-draft-resume')
    fireEvent.click(screen.getByTestId('mock-draft-resume'))
    act(() => { vi.setSystemTime(Date.now() + 10000); document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(saved().state.picks).toHaveLength(1))
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(saved().state.picks).toHaveLength(1)
  })

  it('reset clears the checkpoint so reload starts at setup', async () => {
    localStorage.setItem(key, JSON.stringify(checkpoint()))
    const view = render(<MockDraftSleeperRoomClient viewerId="viewer" />)
    await screen.findByTestId('mock-draft-reset')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByTestId('mock-draft-reset'))
    await waitFor(() => expect(localStorage.getItem(key)).toBeNull())
    view.unmount()
    render(<MockDraftSleeperRoomClient viewerId="viewer" />)
    await screen.findByTestId('mock-draft-entry-open')
    expect(screen.queryByText(/Recovered your mock draft/)).toBeNull()
  })

  it('does not restore another account or another league checkpoint', async () => {
    localStorage.setItem(key, JSON.stringify(checkpoint()))
    render(<MockDraftSleeperRoomClient viewerId="someone-else" />)
    await screen.findByTestId('mock-draft-entry-open')
    expect(screen.queryByText(/Recovered your mock draft/)).toBeNull()
  })

  it('warns on unavailable storage instead of silently promising recovery', async () => {
    localStorage.setItem(key, JSON.stringify(checkpoint()))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota') })
    render(<MockDraftSleeperRoomClient viewerId="viewer" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('could not save your mock progress')
  })
})


describe('native NBA league entry and checkpoint', () => {
  it('opens a native league link, preserves custom setup and restores its mock paused', async () => {
    const nativeKey = 'af:mock-draft:v1:viewer:native-nba'
    const rosterSlots = ['UTIL', 'UTIL', 'UTIL', 'UTIL', 'SUPER_UTIL', 'BN', 'BN', 'BN', 'BN']
    const league = {
      leagueId: 'native-nba', platformLeagueId: 'native-nba', leagueName: 'NBA Redraft', sport: 'NBA', scoring: 'Points', isDynasty: false,
      teamCount: 16, rounds: 9, draftType: 'snake', superflex: false, rosterSlots, detectedUserSlot: 1, hasExplicitDraftOrder: true,
      managers: Array.from({ length: 16 }, (_, index) => ({ slot: index + 1, rosterId: index + 1, managerId: `manager-${index}`, managerName: `Manager ${index + 1}`, avatarUrl: null, isUser: index === 0, slotPredicted: false, isOrphan: index > 2, role: 'member', record: { wins: 0, losses: 0, ties: 0, pointsFor: 0 } })),
    }
    const fetchMock = vi.fn(async (input: string, options?: RequestInit) => {
      expect(options?.method ?? 'GET').toBe('GET')
      if (input.startsWith('/api/league/list')) return new Response(JSON.stringify({ leagues: [{ id: 'imported-nfl', name: 'Other NFL league', sport: 'NFL', platform: 'sleeper' }] }))
      if (input.startsWith('/api/mock-draft/adp?')) {
        expect(new URL(input, 'https://allfantasy.ai').searchParams.get('limit')).toBe('1000')
        return new Response(JSON.stringify({ entries: checkpoint().state.availablePlayers.map(player => ({ ...player, playerId: player.id, adp: player.id === 'Alpha' ? null : player.adp })) }))
      }
      if (input.startsWith('/api/mock-draft?')) return new Response(JSON.stringify({ league }))
      throw new Error(`Unexpected request: ${input}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<MockDraftSleeperRoomClient viewerId="viewer" initialLeagueId="native-nba" initialSport="NBA" />)
    await screen.findByText(/16 teams.*9 rounds.*Points.*snake/)
    expect(screen.queryByTestId('mock-draft-league-card-imported-nfl')).toBeNull()
    expect(screen.queryByText('No Sleeper leagues are available on this account yet.')).toBeNull()
    expect((screen.getByTestId('mock-draft-league-seat-select') as HTMLSelectElement).value).toBe('1')
    fireEvent.click(screen.getByTestId('mock-draft-league-start'))
    await screen.findByTestId('mock-draft-pause')
    fireEvent.click(screen.getByTestId('mock-draft-pause'))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(nativeKey)!).state.status).toBe('paused'))
    const state = JSON.parse(localStorage.getItem(nativeKey)!).state
    expect(state.settings).toMatchObject({ teamCount: 16, rounds: 9, sport: 'NBA', scoring: 'Points', rosterSlots })
    expect(state.teams).toHaveLength(16)
    expect(state.availablePlayers).toHaveLength(4)
    expect(state.availablePlayers.find((player: {id:string}) => player.id === 'Alpha')).toMatchObject({adp:null, projectedPts:0})
    expect(state.teams[0].rosterNeeds).toEqual([])
    view.unmount()
    render(<MockDraftSleeperRoomClient viewerId="viewer" initialLeagueId="native-nba" initialSport="NBA" />)
    await screen.findByText(/Recovered your mock draft/)
    expect(JSON.parse(localStorage.getItem(nativeKey)!).state.settings.rosterSlots).toEqual(rosterSlots)
    expect(screen.getByTestId('mock-draft-resume')).toBeDefined()
  })
})

describe('mock room headshots', () => {
  it('shows the player headshot in the pool, and a mock saved before headshots still restores with initials', async () => {
    const cp = checkpoint()
    cp.state.availablePlayers[0] = { ...cp.state.availablePlayers[0], headshotUrl: 'https://cdn.example.com/headshots/alpha.png', teamLogoUrl: null } as any
    localStorage.setItem(key, JSON.stringify(cp))
    render(<MockDraftSleeperRoomClient viewerId="viewer" />)
    await screen.findByTestId('mock-draft-resume')
    const alpha = screen.getAllByTestId('mock-draft-player-avatar-Alpha-root')[0]!
    expect(alpha.getAttribute('data-avatar-source')).toBe('headshot')
    // Bravo was saved without any asset fields: it falls back to initials, not a broken image.
    const bravo = screen.getAllByTestId('mock-draft-player-avatar-Bravo-root')[0]!
    expect(bravo.getAttribute('data-avatar-source')).toBe('fallback')
  })
})

describe('mock draft pool — AF ADP', () => {
  it('shows AF ADP beside market ADP, sorts by it on request, and an older save without it still restores', async () => {
    const cp = checkpoint()
    // Market order Alpha(1) Bravo(2) Charlie(3) Delta(4). AF ADP flips Alpha and Charlie; Delta was
    // saved before AF ADP existed and carries none.
    const afAdp: Record<string, number | null> = { Alpha: 3.4, Bravo: 2.1, Charlie: 0.9 }
    cp.state.availablePlayers = cp.state.availablePlayers.map((p: any) =>
      p.name in afAdp ? { ...p, afAdp: afAdp[p.name], afAdpContributions: { market: 0.5, imported: 0, af: 0.5 }, afAdpOwnSampleSize: 40 } : p,
    )
    localStorage.setItem(key, JSON.stringify(cp))
    render(<MockDraftSleeperRoomClient viewerId="viewer" />)
    await screen.findByTestId('mock-draft-resume')

    expect(screen.getAllByTestId('mock-draft-player-adp-Alpha')[0]!.textContent).toBe('1.0')
    const alphaAf = screen.getAllByTestId('mock-draft-player-af-adp-Alpha')[0]!
    expect(alphaAf.textContent).toBe('AF 3.4')
    expect(alphaAf.getAttribute('title')).toContain('AllFantasy leagues 50% (40 drafts)')
    expect(screen.getAllByTestId('mock-draft-player-af-adp-Delta')[0]!.textContent).toBe('AF —')

    const order = () =>
      screen
        .getAllByTestId(/^mock-draft-player-row-/)
        .map((row) => row.getAttribute('data-testid')!.replace('mock-draft-player-row-', ''))
        .filter((id, i, all) => all.indexOf(id) === i)
    expect(order()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
    fireEvent.click(screen.getAllByTestId('mock-draft-sort-af-adp')[0]!)
    expect(order()).toEqual(['Charlie', 'Bravo', 'Alpha', 'Delta'])
  })
})
