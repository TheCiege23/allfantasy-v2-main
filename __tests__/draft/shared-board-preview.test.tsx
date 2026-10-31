import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DraftBoardPreview, type DraftBoardPreviewPick } from '@/components/app/draft-room/DraftBoardPreview'
import { DraftRightDockTabs } from '@/components/app/draft-room/DraftRightDockTabs'
import { positionTintHex } from '@/lib/draft-room/positionTint'

const teams = [
  { id: 'one', slot: 1, name: 'Manager One', isUser: true },
  { id: 'two', slot: 2, name: 'Manager Two', isCpu: true },
]
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function board(picks: DraftBoardPreviewPick[] = [], props: Partial<React.ComponentProps<typeof DraftBoardPreview>> = {}) {
  return <DraftBoardPreview teams={teams} picks={picks} teamCount={2} rounds={4} sport="NFL" {...props} />
}

describe('shared board used by mock engines', () => {
  it.each([
    ['NFL', 'QB'], ['NBA', 'PG'], ['NHL', 'LW'], ['MLB', 'SP'],
    ['NCAAF', 'WR'], ['NCAAB', 'SF'], ['SOCCER', 'GK'],
  ])('renders a %s pick in the live board position color', (sport, position) => {
    render(board([{ overall: 1, round: 1, slot: 1, rosterId: 'one', playerName: 'Example Player', position, team: 'FA' }], { sport }))
    const cell = screen.getByTestId('draft-board-cell-1')
    expect(cell).toHaveTextContent('Example Player')
    expect(cell).toHaveStyle({ backgroundColor: positionTintHex(position)! })
    expect(cell).toHaveAttribute('data-owner-roster', 'one')
    expect(screen.getAllByRole('group', { name: /Draft pick.*empty slot/ })).toHaveLength(7)
  })

  it('keeps manager columns fixed while round two snakes back, and moves the clock after a pick', () => {
    const view = render(board([], { currentOverall: 3 }))
    const round = screen.getByTestId('draft-board-round-2')
    expect([...round.querySelectorAll('[data-overall]')].map(cell => cell.getAttribute('data-overall'))).toEqual(['4', '3'])
    expect(screen.getByTestId('draft-board-cell-3')).toHaveAttribute('data-current', 'true')
    view.rerender(board([{ overall: 3, round: 2, slot: 2, rosterId: 'two', playerName: 'Reverse Pick', position: 'RB' }], { currentOverall: 4 }))
    expect(screen.getByTestId('draft-board-cell-3')).toHaveTextContent('Reverse Pick')
    expect(screen.getByTestId('draft-board-cell-4')).toHaveAttribute('data-current', 'true')
  })

  it('uses linear and 3RR order through the same board', () => {
    const view = render(board([], { draftType: 'linear' }))
    expect(screen.getByTestId('draft-board-round-2-direction')).toHaveAttribute('data-direction', 'forward')
    view.rerender(board([], { thirdRoundReversal: true }))
    expect(screen.getByTestId('draft-board-round-3-direction')).toHaveAttribute('data-direction', 'reverse')
    expect(screen.getByTestId('draft-board-round-4-direction')).toHaveAttribute('data-direction', 'forward')
  })

  it('keeps a traded future pick empty and assigns it to its current owner', () => {
    render(board([{ overall: 4, round: 2, slot: 1, rosterId: 'two', originalRosterId: 'one', playerName: null }]))
    const cell = screen.getByTestId('draft-board-cell-4')
    expect(cell).toHaveAttribute('data-owner-roster', 'two')
    expect(cell).toHaveAccessibleName(/empty slot/)
    expect(cell).toHaveTextContent('Manager Two')
  })

  it('groups auction selections under the purchasing manager', () => {
    render(board([{ overall: 1, round: 1, slot: 1, rosterId: 'two', playerName: 'Auction Player', position: 'C', amount: 21 }], { sport: 'NBA', draftType: 'auction' }))
    const cell = screen.getByTestId('draft-board-cell-1')
    expect(cell).toHaveTextContent('Auction Player')
    expect(cell).toHaveTextContent('21')
    expect(cell).toHaveAttribute('data-owner-roster', 'two')
  })
})

describe('dock navigation in a narrow panel', () => {
  it('reaches all seven tabs with the keyboard and preserves the queue body', () => {
    render(<DraftRightDockTabs queueBody={<input aria-label="Queue note" defaultValue="Keep this" />}
      rosterBody={<div>Roster</div>} chatBody={<div>Chat</div>} intelBody={<div>Intel</div>}
      chimmyBody={<div>Chimmy</div>} warRoomBody={<div>Legacy</div>} activityBody={<div>Activity</div>} />)
    const tabs = screen.getByRole('tablist')
    const queue = within(tabs).getByRole('tab', { name: 'Queue' })
    queue.focus()
    fireEvent.keyDown(queue, { key: 'End' })
    expect(within(tabs).getByRole('tab', { name: 'Chat' })).toHaveFocus()
    expect(within(tabs).getByRole('tab', { selected: true })).toHaveTextContent('Chat')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(queue).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Queue note' })).toHaveValue('Keep this')
  })
})
