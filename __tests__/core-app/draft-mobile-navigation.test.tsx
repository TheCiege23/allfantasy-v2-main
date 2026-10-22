import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DraftRoomShell } from '@/components/app/draft-room/DraftRoomShell'
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (key: string) => key.split('.').pop() }) }))
beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function setup() {
  const change = vi.fn()
  render(<DraftRoomShell topBar={null} managerStrip={null}
    draftBoard={<div>Wide draft board</div>} playerPanel={<div>Player list</div>}
    queuePanel={<div>Queue</div>} chatPanel={<div>Chat</div>}
    helperPanel={<div>Assistant</div>} rosterPanel={<div>Roster</div>}
    mobileTab="board" onMobileTabChange={change} />)
  return change
}
it('keeps horizontal board gestures inside the board instead of switching mobile tabs', () => {
  const change = setup()
  const board = screen.getByTestId('draft-mobile-board-scroll')
  fireEvent.touchStart(board, { touches: [{ clientX: 300, clientY: 200 }] })
  fireEvent.touchEnd(board, { changedTouches: [{ clientX: 40, clientY: 205 }] })
  expect(change).not.toHaveBeenCalled()
})
it('opens the selected draft destination with a tap', () => {
  const change = setup()
  fireEvent.click(within(screen.getByTestId('draft-mobile-layout')).getByRole('button', { name: 'players', exact: true }))
  expect(change).toHaveBeenCalledExactlyOnceWith('players')
})

it('keeps extra tools collapsed, opens the selected tool, and closes after selection', () => {
  const change = setup()
  expect(screen.queryByTestId('draft-mobile-quick-dock')).toBeNull()
  fireEvent.click(screen.getByTestId('draft-mobile-more'))
  expect(screen.getByTestId('draft-mobile-more').getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(screen.getByTestId('draft-mobile-tab-roster'))
  expect(change).toHaveBeenCalledExactlyOnceWith('roster')
  expect(screen.queryByTestId('draft-mobile-quick-dock')).toBeNull()
})
it('Escape dismisses tools and restores focus without blocking the room', () => {
  setup()
  fireEvent.click(screen.getByTestId('draft-mobile-more'))
  fireEvent.keyDown(screen.getByTestId('draft-mobile-tab-roster'), { key: 'Escape' })
  expect(screen.queryByTestId('draft-mobile-quick-dock')).toBeNull()
  expect(document.activeElement).toBe(screen.getByTestId('draft-mobile-more'))
  expect(document.querySelector('[inert]')).toBeNull()
})
