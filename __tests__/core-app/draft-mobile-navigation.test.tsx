import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DraftRoomShell } from '@/components/app/draft-room/DraftRoomShell'
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (key: string) => key.split('.').pop() }) }))
afterEach(cleanup)
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
