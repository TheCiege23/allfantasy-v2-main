import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DraftBoardCell, type DraftBoardCellPick } from '@/components/app/draft-room/DraftBoardCell'

vi.mock('@/components/app/draft-room/LazyDraftImage', () => ({
  LazyDraftImage: () => null,
}))

function makePick(overrides: Partial<DraftBoardCellPick> = {}): DraftBoardCellPick {
  return {
    overall: 5,
    round: 1,
    slot: 5,
    pickLabel: '1.05',
    playerName: 'Justin Jefferson',
    position: 'WR',
    team: 'MIN',
    playerId: 'pid-jj',
    playerImageUrl: null,
    sport: 'NFL',
    injuryStatus: null,
    byeWeek: 6,
    displayName: 'Team E',
    ...overrides,
  }
}

describe('DraftBoardCell commissioner edit affordance', () => {
  it('renders the edit button when onCommissionerEditPick is provided', () => {
    render(
      <DraftBoardCell
        pick={makePick()}
        isEmpty={false}
        onCommissionerEditPick={() => {}}
      />,
    )
    expect(screen.getByTestId('draft-board-cell-commish-edit-5')).toBeInTheDocument()
  })

  it('does not render the edit button when onCommissionerEditPick is omitted (e.g. non-commissioner / live draft)', () => {
    render(<DraftBoardCell pick={makePick()} isEmpty={false} />)
    expect(screen.queryByTestId('draft-board-cell-commish-edit-5')).toBeNull()
  })

  it('clicking the edit button calls the callback and stops propagation', () => {
    const onEdit = vi.fn()
    const onParentClick = vi.fn()
    render(
      <div onClick={onParentClick}>
        <DraftBoardCell
          pick={makePick()}
          isEmpty={false}
          onCommissionerEditPick={onEdit}
        />
      </div>,
    )
    fireEvent.click(screen.getByTestId('draft-board-cell-commish-edit-5'))
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onParentClick).not.toHaveBeenCalled()
  })

  it('renders the edit button on empty cells too (supports ASSIGN / CHANGE_PICK_OWNER)', () => {
    render(
      <DraftBoardCell
        pick={makePick({ playerName: null, position: null, team: null, displayName: 'Team E' })}
        isEmpty={true}
        onCommissionerEditPick={() => {}}
      />,
    )
    expect(screen.getByTestId('draft-board-cell-commish-edit-5')).toBeInTheDocument()
  })
})

describe('DraftBoardCell player name', () => {
  it('keeps a space between the first- and last-name lines in the tile text', () => {
    const { container } = render(<DraftBoardCell pick={makePick({ playerName: 'Atlas Runner' })} isEmpty={false} />)
    expect(container.textContent).toMatch(/Atlas Runner/)
    expect(container.textContent).not.toMatch(/AtlasRunner/)
  })
})
