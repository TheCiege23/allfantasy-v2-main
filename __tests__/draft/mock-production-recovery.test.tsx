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
  // The mobile drawer is the same production component mounted alongside desktop content.
  fireEvent.click(screen.getByRole('button', { name: 'Players', exact: true }))
  return within(screen.getByRole('dialog', { name: 'Players', exact: true }))
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
