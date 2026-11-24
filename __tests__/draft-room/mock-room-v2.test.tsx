/**
 * Room v2, phase 5 (2026-11): the mock room on the live room's shell — the shared header with the
 * mock's own Pause / Reset / Export, the board-first layout with the tablet tab bar, Draft leading
 * every pool row, the AF position palette, and round-1 picks announced as a tap-through toast.
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MockDraftSleeperRoomClient, { mockPickLabel } from '@/components/mock-draft/MockDraftSleeperRoomClient'
import { DraftRoundOneAnnouncementOverlay } from '@/components/app/draft-room/DraftRoundOneAnnouncementOverlay'
import { positionTintHex } from '@/lib/draft-room/positionTint'

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

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ leagues: [] }), { status: 200 })))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function renderRoom(overrides: Record<string, unknown> = {}) {
  localStorage.setItem(key, JSON.stringify(checkpoint(overrides)))
  render(<MockDraftSleeperRoomClient viewerId="viewer" />)
  await screen.findByTestId('mock-draft-resume')
}

describe('mock room v2 — the live room\'s shell and header', () => {
  it('renders inside DraftRoomShell with the shared header, and never says "Sleeper"', async () => {
    await renderRoom()
    expect(screen.getByTestId('draft-room-shell')).toBeTruthy()
    expect(screen.getByTestId('draft-topbar-center-slot').getAttribute('data-room-v2-pill')).toBe('true')
    expect(screen.getByTestId('draft-topbar-center-slot').textContent).toContain('1.01')
    expect(document.body.textContent).not.toMatch(/sleeper/i)
  })

  it('labels picks round.pick like the live room', () => {
    expect(mockPickLabel(1, 12)).toBe('1.01')
    expect(mockPickLabel(14, 12)).toBe('2.02')
    expect(mockPickLabel(24, 12)).toBe('2.12')
  })

  it('Pause / Resume sit in the header; Reset and Export are ⋯ menu rows; no commissioner rows', async () => {
    await renderRoom()
    // The AUTO pill: a missed clock turns it on (as in a live draft), and this is how it goes off.
    const autoPill = screen.getByTestId('draft-topbar-autopick-pill')
    expect(autoPill.textContent).toMatch(/off/i)
    fireEvent.click(autoPill)
    expect(screen.getByTestId('draft-topbar-autopick-pill').textContent).toMatch(/on/i)
    fireEvent.click(screen.getByTestId('draft-topbar-autopick-pill'))
    fireEvent.click(screen.getByTestId('mock-draft-resume'))
    expect(await screen.findByTestId('mock-draft-pause')).toBeTruthy()
    fireEvent.click(screen.getByTestId('draft-topbar-menu-toggle'))
    const menu = screen.getByTestId('draft-topbar-menu')
    expect(menu.contains(screen.getByTestId('mock-draft-reset'))).toBe(true)
    expect(menu.contains(screen.getByTestId('mock-draft-export'))).toBe(true)
    expect(screen.queryByTestId('draft-topbar-set-order')).toBeNull()
    // A solo mock has nobody to invite.
    expect(screen.queryByTestId('draft-copy-invite-inline')).toBeNull()
    expect(screen.queryByTestId('draft-topbar-copy-invite')).toBeNull()
    expect(screen.queryByTestId('draft-topbar-open-settings')).toBeNull()
  })

  it('a CPU turn reads "CPU picking" in the clock pill, never an empty "in progress –"', async () => {
    await renderRoom({ onTheClock: 2, currentPick: 2, picks: [{ overall: 1, round: 1, pick: 1, slot: 1, playerId: 'Alpha', playerName: 'Alpha', position: 'PG', team: 'LAL', adp: 1, projectedPts: 80, isUser: true, managerName: 'Manager 1' }] })
    expect(screen.queryByTestId('draft-topbar-idle-clock')).toBeNull()
    fireEvent.click(screen.getByTestId('mock-draft-resume'))
    expect((await screen.findByTestId('draft-topbar-idle-clock')).textContent).toBe('CPU picking')
    expect(screen.queryByTestId('draft-topbar-timer-value')).toBeNull()
  })

  it('on a tablet one tab bar leads with Players, and a dock tab takes the screen from the pool', async () => {
    await renderRoom()
    const tabs = within(screen.getByTestId('mock-draft-tablet-tabbar')).getAllByRole('tab').map(tab => tab.textContent)
    expect(tabs).toEqual(['Players', 'Queue', 'Roster', 'Chat'])
    const pool = screen.getByTestId('mock-draft-pool-panel').parentElement!
    const dock = screen.getByTestId('mock-draft-dock')
    expect(pool.className).not.toContain('max-lg:hidden')
    expect(dock.className).toContain('max-lg:hidden')
    fireEvent.click(screen.getByTestId('mock-draft-tablet-tab-chat'))
    expect(screen.getByTestId('mock-draft-tablet-tab-chat').getAttribute('aria-selected')).toBe('true')
    expect(pool.className).toContain('max-lg:hidden')
    expect(dock.className).not.toContain('max-lg:hidden')
    expect(within(dock).getByTestId('mock-draft-chat-input')).toBeTruthy()
  })
})

describe('mock room v2 — the pool', () => {
  it('Draft leads every row, before Queue and the player, and is a 44px target', async () => {
    await renderRoom()
    const row = screen.getAllByTestId('mock-draft-pool-row-Alpha')[0]
    const buttons = Array.from(row.querySelectorAll(':scope > button'))
    expect(buttons.map(b => b.getAttribute('data-testid'))).toEqual([
      'mock-draft-player-draft-Alpha', 'mock-draft-queue-add-Alpha', 'mock-draft-player-row-Alpha',
    ])
    expect(buttons[0].className).toContain('h-11')
    expect(buttons[1].className).toContain('h-11')
  })

  it('Draft is off until your turn, then drafts the player', async () => {
    await renderRoom()
    const draft = () => screen.getAllByTestId('mock-draft-player-draft-Alpha')[0] as HTMLButtonElement
    expect(draft().disabled).toBe(true)
    fireEvent.click(screen.getByTestId('mock-draft-resume'))
    await waitFor(() => expect(draft().disabled).toBe(false))
    fireEvent.click(draft())
    await waitFor(() => expect(saved().state.picks[0]?.playerId).toBe('Alpha'))
  })

  it('position chips use the AF palette for the sport', async () => {
    await renderRoom()
    const row = screen.getAllByTestId('mock-draft-player-row-Alpha')[0]
    const chip = Array.from(row.querySelectorAll('div')).find(el => el.textContent === 'PG') as HTMLElement
    const expected = positionTintHex('PG', 'NBA')!
    const toRgb = (hex: string) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`
    expect(chip.style.backgroundColor).toBe(toRgb(expected))
  })
})

describe('mock room v2 — round-1 announcement', () => {
  it('a round-1 pick shows the announcement as a toast taps pass around', async () => {
    await renderRoom()
    expect(screen.queryByTestId('draft-round-one-announcement')).toBeNull()
    fireEvent.click(screen.getByTestId('mock-draft-resume'))
    await waitFor(() => expect((screen.getAllByTestId('mock-draft-player-draft-Alpha')[0] as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getAllByTestId('mock-draft-player-draft-Alpha')[0])
    const card = await screen.findByTestId('draft-round-one-announcement')
    expect(card.getAttribute('data-variant')).toBe('toast')
    expect(card.getAttribute('role')).toBe('status')
    expect(card.className).toContain('pointer-events-none')
    expect(card.textContent).toContain('Alpha')
  })

  it('your own card keeps its time when a CPU manager picks right after you', async () => {
    await renderRoom()
    fireEvent.click(screen.getByTestId('mock-draft-resume'))
    await waitFor(() => expect((screen.getAllByTestId('mock-draft-player-draft-Alpha')[0] as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getAllByTestId('mock-draft-player-draft-Alpha')[0])
    await screen.findByTestId('draft-round-one-announcement')
    // Manager 2 (CPU) picks next, still in round 1.
    await waitFor(() => expect(saved().state.picks).toHaveLength(2), { timeout: 8_000 })
    await waitFor(() => expect(screen.getByTestId('draft-round-one-announcement').textContent).toContain('Alpha'))
    expect(screen.getByTestId('draft-round-one-announcement').textContent).toContain('1.01')
  }, 15_000)

  it('picks already on the board when a mock is restored are not announced again', async () => {
    const pick = { overall: 1, round: 1, pick: 1, slot: 1, playerId: 'Alpha', playerName: 'Alpha', position: 'PG', team: 'LAL', adp: 1, projectedPts: 80, isUser: true, managerName: 'Manager 1' }
    await renderRoom({
      picks: [pick], currentPick: 2, onTheClock: 2,
      availablePlayers: ['Bravo', 'Charlie', 'Delta'].map((name, index) => ({ id: name, name, position: 'PG', team: 'LAL', adp: index + 2, projectedPts: 80, ownership: 10, injuryStatus: null, tier: 1, posRank: 'PG1', isRookie: false })),
    })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(screen.queryByTestId('draft-round-one-announcement')).toBeNull()
  })
})

describe('round-1 card variants', () => {
  const item = {
    id: 'r1', headshotUrl: null, teamLogoUrl: null,
    pick: { id: 'p', overall: 3, round: 1, slot: 3, rosterId: '3', displayName: 'Manager 3', playerName: 'Charlie', position: 'PG', team: 'LAL', byeWeek: null, playerId: 'c', playerImageUrl: null, tradedPickMeta: null, source: 'mock', pickLabel: '1.03', amount: null, createdAt: '' },
  }

  it('the live modal dims the room and a backdrop tap dismisses it', () => {
    const onDismiss = vi.fn()
    render(<DraftRoundOneAnnouncementOverlay queue={[item as never]} onDismissFront={onDismiss} />)
    const card = screen.getByTestId('draft-round-one-announcement')
    expect(card.getAttribute('role')).toBe('dialog')
    expect(card.className).toContain('bg-black/55')
    fireEvent.click(card)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('the toast has no backdrop and only Skip dismisses it', () => {
    const onDismiss = vi.fn()
    render(<DraftRoundOneAnnouncementOverlay variant="toast" queue={[item as never]} onDismissFront={onDismiss} />)
    const card = screen.getByTestId('draft-round-one-announcement')
    expect(card.className).not.toContain('bg-black/55')
    fireEvent.click(card)
    expect(onDismiss).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('draft-round-one-announcement-skip'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
