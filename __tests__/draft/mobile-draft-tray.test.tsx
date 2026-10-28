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

  it('starts on the board, opens queue halfway, and gives players the full tray', () => {
    render(<Room />)
    expect(tray().getAttribute('data-snap')).toBe('peek')
    fireEvent.click(screen.getByTestId('draft-mobile-tab-queue'))
    expect(tray().getAttribute('data-snap')).toBe('half')
    fireEvent.click(screen.getByTestId('draft-mobile-tab-players'))
    expect(tray().getAttribute('data-snap')).toBe('full')
    expect(screen.getByTestId('draft-mobile-content').getAttribute('data-active-tab')).toBe('players')
  })

  it('the Board tab collapses the tray', () => {
    render(<Room initial="queue" />)
    expect(tray().getAttribute('data-snap')).toBe('half')
    fireEvent.click(screen.getByTestId('draft-mobile-tab-board'))
    expect(tray().getAttribute('data-snap')).toBe('peek')
  })

  it('collapsing from the handle reports "board", and reopening restores the previous tab', () => {
    const onChange = vi.fn()
    render(<Room initial="queue" onChange={onChange} />)
    fireEvent.keyDown(handle(), { key: 'ArrowDown' })
    expect(tray().getAttribute('data-snap')).toBe('peek')
    expect(onChange).toHaveBeenLastCalledWith('board')
    fireEvent.keyDown(handle(), { key: 'ArrowUp' })
    expect(tray().getAttribute('data-snap')).toBe('half')
    expect(onChange).toHaveBeenLastCalledWith('queue')
  })

  it('the handle is keyboard-operable and announces its state', () => {
    render(<Room initial="players" />)
    expect(handle().getAttribute('aria-expanded')).toBe('true')
    expect(tray().getAttribute('data-snap')).toBe('full')
    fireEvent.keyDown(handle(), { key: 'ArrowDown' })
    expect(tray().getAttribute('data-snap')).toBe('half')
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
