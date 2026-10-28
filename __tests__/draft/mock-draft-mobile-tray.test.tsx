import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MockDraftSleeperRoomClient from '@/components/mock-draft/MockDraftSleeperRoomClient'

const key = 'af:mock-draft:v1:viewer:open'
function checkpoint() {
  return {
    version: 1, mode: 'open', queue: [] as string[], draftId: null, shareId: null,
    state: {
      settings: { teamCount: 2, rounds: 2, draftType: 'snake', sport: 'NBA', scoring: 'Points', superflex: false, myPickSlot: 1, speed: 15 },
      teams: [1, 2].map(slot => ({ slot, managerId: String(slot), managerName: `Manager ${slot}`, avatarUrl: null, isUser: slot === 1, isAI: slot !== 1, role: 'member', isOrphan: false, picks: [], rosterNeeds: [] })),
      availablePlayers: ['Alpha', 'Bravo'].map((name, index) => ({ id: name, name, position: 'PG', team: 'LAL', adp: index + 1, projectedPts: 80, ownership: 10, injuryStatus: null, tier: 1, posRank: 'PG1', isRookie: false })),
      picks: [], currentPick: 1, onTheClock: 1, status: 'paused', timerSeconds: 15, pausedRemainingMs: 15000, turnDeadlineMs: null, chatMessages: [],
    },
  }
}
beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(key, JSON.stringify(checkpoint()))
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ leagues: [] }), { status: 200 })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const tray = () => screen.getByTestId('mock-draft-mobile-tray')

describe('mock draft room — shared mobile tray', () => {
  it('starts collapsed with the board on screen, and uses the shared tray (not an overlay)', async () => {
    render(<MockDraftSleeperRoomClient viewerId="viewer" />)
    await screen.findByTestId('mock-draft-resume')
    expect(tray().getAttribute('data-snap')).toBe('peek')
    expect(screen.getByTestId('mock-draft-mobile-layout').textContent).toContain('Manager 1')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a tab opens the tray to half; Board and Close collapse it', async () => {
    render(<MockDraftSleeperRoomClient viewerId="viewer" />)
    await screen.findByTestId('mock-draft-resume')
    fireEvent.click(screen.getByTestId('mock-draft-mobile-tab-players'))
    expect(tray().getAttribute('data-snap')).toBe('half')
    expect(screen.getByRole('region', { name: 'Players' })).toBeTruthy()
    fireEvent.click(screen.getByTestId('mock-draft-mobile-tab-board'))
    expect(tray().getAttribute('data-snap')).toBe('peek')
    fireEvent.click(screen.getByTestId('mock-draft-mobile-tab-roster'))
    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }))
    expect(tray().getAttribute('data-snap')).toBe('peek')
  })

  it('dragging the handle back up reopens the last panel', async () => {
    render(<MockDraftSleeperRoomClient viewerId="viewer" />)
    await screen.findByTestId('mock-draft-resume')
    fireEvent.click(screen.getByTestId('mock-draft-mobile-tab-chat'))
    const handle = screen.getByTestId('mock-draft-mobile-tray-handle')
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(tray().getAttribute('data-snap')).toBe('peek')
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(screen.getByTestId('mock-draft-mobile-content').getAttribute('data-active-tab')).toBe('chat')
  })
})
