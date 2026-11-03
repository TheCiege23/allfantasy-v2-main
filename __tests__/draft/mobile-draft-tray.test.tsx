import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (key: string) => key.split('.').pop() }) }))
import { DraftRoomShell, type MobileDraftTab } from '@/components/app/draft-room/DraftRoomShell'

beforeEach(() => vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

/** Harness that owns `mobileTab` the way DraftRoomPageClient does. */
function Room({ initial = 'board' as MobileDraftTab, onChange = vi.fn() }) {
  const [tab, setTab] = useState<MobileDraftTab>(initial)
  return (
    <DraftRoomShell
      topBar={null}
      managerStrip={null}
      draftBoard={<div>Board grid</div>}
      playerPanel={<div>Player list</div>}
      queuePanel={<div>Queue list</div>}
      chatPanel={<div><textarea aria-label="message" /></div>}
      rosterPanel={<div>Roster</div>}
      mobileTab={tab}
      onMobileTabChange={(next) => { onChange(next); setTab(next) }}
    />
  )
}

const mobile = () => within(screen.getByTestId('draft-mobile-layout'))
const tray = () => screen.getByTestId('draft-mobile-tray')
const handle = () => screen.getByTestId('draft-mobile-tray-handle')

describe('mobile draft tray', () => {
  it('keeps the board on screen whatever tab is open', () => {
    render(<Room initial="players" />)
    expect(screen.getByTestId('draft-mobile-board-scroll').textContent).toContain('Board grid')
    expect(mobile().getByText('Player list')).toBeTruthy()
  })

  it('starts collapsed on the board tab and opens to half when a tab is chosen', () => {
    render(<Room />)
    expect(tray().getAttribute('data-snap')).toBe('peek')
    fireEvent.click(screen.getByTestId('draft-mobile-tab-roster'))
    expect(tray().getAttribute('data-snap')).toBe('half')
    expect(screen.getByTestId('draft-mobile-content').getAttribute('data-active-tab')).toBe('roster')
  })

  it('opens the Chat tab at full height, filling the tray so the composer is on screen', () => {
    render(<Room />)
    fireEvent.click(screen.getByTestId('draft-mobile-tab-chat'))
    expect(tray().getAttribute('data-snap')).toBe('full')
    const sheet = screen.getByTestId('draft-mobile-chat-sheet')
    expect(sheet.className).toMatch(/\bh-full\b/)
    expect(sheet.className).toMatch(/\[&>\*\]:flex-1/)
  })

  it('opens the Players tab at full height — half leaves room for only ~2 player cards', () => {
    render(<Room />)
    fireEvent.click(screen.getByTestId('draft-mobile-tab-players'))
    expect(tray().getAttribute('data-snap')).toBe('full')
    expect(screen.getByTestId('draft-mobile-content').getAttribute('data-active-tab')).toBe('players')
  })

  it('opens the Queue tab at full height too — half showed less than one queued row', () => {
    render(<Room />)
    fireEvent.click(screen.getByTestId('draft-mobile-tab-queue'))
    expect(tray().getAttribute('data-snap')).toBe('full')
    // The queue panel's own list must be the scroller, as with players.
    const sheet = screen.getByTestId('draft-mobile-queue-sheet')
    expect(sheet.className).toMatch(/\bh-full\b/)
    expect(sheet.className).toMatch(/\[&>section\]:flex-1/)
    expect(sheet.textContent).toBe('Queue list')
  })

  it('gives the player panel a definite-height column, so its own list is the scroller', () => {
    render(<Room initial="players" />)
    const sheet = screen.getByTestId('draft-mobile-players-sheet')
    const scroll = screen.getByTestId('draft-mobile-players-scroll')
    // An auto-height wrapper here let PlayerPanel grow to every row, and touch scrolling died.
    expect(sheet.className).toMatch(/\bh-full\b/)
    expect(sheet.className).toMatch(/\bflex-col\b/)
    expect(scroll.className).toMatch(/\bflex-1\b/)
    expect(scroll.className).toMatch(/\bmin-h-0\b/)
  })

  it('the Board tab collapses the tray', () => {
    render(<Room initial="roster" />)
    expect(tray().getAttribute('data-snap')).toBe('half')
    fireEvent.click(screen.getByTestId('draft-mobile-tab-board'))
    expect(tray().getAttribute('data-snap')).toBe('peek')
  })

  it('collapsing from the handle reports "board", and reopening restores the previous tab', () => {
    const onChange = vi.fn()
    render(<Room initial="roster" onChange={onChange} />)
    fireEvent.keyDown(handle(), { key: 'ArrowDown' })
    expect(tray().getAttribute('data-snap')).toBe('peek')
    expect(onChange).toHaveBeenLastCalledWith('board')
    fireEvent.keyDown(handle(), { key: 'ArrowUp' })
    expect(tray().getAttribute('data-snap')).toBe('half')
    expect(onChange).toHaveBeenLastCalledWith('roster')
  })

  it('the handle is keyboard-operable and announces its state', () => {
    render(<Room initial="roster" />)
    expect(handle().getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(handle(), { key: 'Enter' })
    expect(tray().getAttribute('data-snap')).toBe('full')
    fireEvent.keyDown(handle(), { key: 'Enter' })
    expect(tray().getAttribute('data-snap')).toBe('peek')
    expect(handle().getAttribute('aria-expanded')).toBe('false')
  })

  it('focusing the chat composer expands the tray to full', () => {
    render(<Room initial="chat" />)
    fireEvent.focus(mobile().getByLabelText('message'))
    expect(tray().getAttribute('data-snap')).toBe('full')
  })
})
