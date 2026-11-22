/**
 * Keeper board, option B (2026-11-15): a kept player is drawn LOCKED — dark striped tile, coloured
 * edge, "Kept"/"Yours" pill and the round it cost — never a solid tile that reads as a real pick.
 * Team headers count keepers, and a roll call above the board lists every keeper.
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DraftBoard } from '@/components/app/draft-room/DraftBoard'
import { KeeperRollCall, keeperPickLabel, orderKeeperRollCall } from '@/components/app/draft-room/KeeperRollCall'

afterEach(cleanup)

const slotOrder = [1, 2, 3].map((slot) => ({ slot, rosterId: `r${slot}`, displayName: `Team ${slot}` }))

// 3 teams, snake: round 2 runs right to left, so slot 2 in round 2 is overall 5; slot 3 in round 3 is overall 9.
const locks = [
  { round: 3, slot: 3, overall: 9, rosterId: 'r3', displayName: 'Team 3', playerName: 'Legacy Runner', position: 'RB', team: 'NYJ', playerId: 'k3', isKeeper: true as const },
  { round: 2, slot: 2, overall: 5, rosterId: 'r2', displayName: 'Team 2', playerName: 'Veteran Hands', position: 'WR', team: 'GB', playerId: 'k2', isKeeper: true as const },
]

const drafted = {
  id: 'p1', overall: 1, round: 1, slot: 1, rosterId: 'r1', displayName: 'Team 1', playerName: 'Atlas Runner',
  position: 'RB', team: 'NYJ', byeWeek: 9, playerId: 'a1', tradedPickMeta: null, pickLabel: '1.01', createdAt: '',
} as unknown as Parameters<typeof DraftBoard>[0]['picks'][number]

function renderBoard() {
  return render(
    <DraftBoard
      picks={[drafted]}
      slotOrder={slotOrder}
      teamCount={3}
      rounds={3}
      draftType="snake"
      thirdRoundReversal={false}
      keeperLocks={locks}
      currentUserRosterId="r2"
      currentOverallPick={2}
    />,
  )
}

describe('kept players on the draft board', () => {
  it('labels a kept player as kept, with the round it cost, and never as a pick', () => {
    renderBoard()
    const other = screen.getByTestId('draft-board-cell-9')
    expect(other).toHaveAccessibleName(/^Kept player Legacy Runner/)
    expect(within(other).getByTestId('draft-board-cell-keeper-9')).toHaveTextContent('Kept')
    expect(within(other).getByTestId('draft-board-cell-keeper-cost-9')).toHaveTextContent('Costs Rd 3')

    const pick = screen.getByTestId('draft-board-cell-1')
    expect(pick).toHaveAccessibleName(/^Atlas Runner/)
    expect(screen.queryByTestId('draft-board-cell-keeper-1')).toBeNull()
    expect(screen.queryByTestId('draft-board-cell-keeper-cost-1')).toBeNull()
  })

  it("marks the viewer's own keeper as theirs", () => {
    renderBoard()
    const mine = screen.getByTestId('draft-board-cell-5')
    expect(mine).toHaveAccessibleName(/^Your kept player Veteran Hands/)
    expect(within(mine).getByTestId('draft-board-cell-keeper-5')).toHaveTextContent('Yours')
    expect(within(mine).getByTestId('draft-board-cell-keeper-cost-5')).toHaveTextContent('Costs your Rd 2')
  })

  it('draws a kept tile dark and outlined, not as a solid position tile', () => {
    renderBoard()
    const kept = screen.getByTestId('draft-board-cell-9')
    const pick = screen.getByTestId('draft-board-cell-1')
    expect(kept.style.backgroundColor).toBe('rgb(16, 26, 46)')
    expect(kept.style.backgroundImage).toContain('repeating-linear-gradient')
    expect(pick.style.backgroundColor).not.toBe('rgb(16, 26, 46)')
    expect(pick.style.backgroundImage).toBe('')
    // Only the viewer's keeper carries the accent ring.
    expect(screen.getByTestId('draft-board-cell-5').style.boxShadow).toContain('#22d3ee')
    expect(kept.style.boxShadow).not.toContain('#22d3ee')
  })

  it('counts keepers in the team headers that have one', () => {
    renderBoard()
    expect(screen.getByTestId('draft-board-team-header-keepers-2')).toHaveTextContent('1')
    expect(screen.getByTestId('draft-board-team-header-keepers-3')).toHaveTextContent('1')
    expect(screen.queryByTestId('draft-board-team-header-keepers-1')).toBeNull()
  })
})

describe('keeper roll call', () => {
  beforeEach(() => window.localStorage.clear())

  it('labels the pick a keeper used as round.pick-in-round', () => {
    expect(keeperPickLabel({ round: 4, overall: 39 }, 10)).toBe('4.9')
    expect(keeperPickLabel({ round: 2, overall: 5 }, 3)).toBe('2.2')
  })

  it("puts the viewer's keepers first, then draft slot order", () => {
    expect(orderKeeperRollCall(locks, 'r2').map((l) => l.rosterId)).toEqual(['r2', 'r3'])
    expect(orderKeeperRollCall(locks, null).map((l) => l.rosterId)).toEqual(['r2', 'r3'])
    expect(orderKeeperRollCall(locks.slice().reverse(), 'r3').map((l) => l.rosterId)).toEqual(['r3', 'r2'])
  })

  it('lists every keeper and tells the viewer which pick theirs used', () => {
    render(<KeeperRollCall locks={locks} teamCount={3} currentUserRosterId="r2" teamNameByRosterId={{ r3: 'Sunday Funday' }} />)
    const chips = within(screen.getByTestId('draft-keeper-rollcall-list')).getAllByRole('listitem')
    expect(chips).toHaveLength(2)
    expect(chips[0]).toHaveTextContent('You')
    expect(chips[0]).toHaveTextContent('Veteran Hands')
    expect(chips[1]).toHaveTextContent('Sunday Funday')
    expect(chips[1]).toHaveTextContent('RB · NYJ · costs Rd 3')
    expect(screen.getByTestId('draft-keeper-rollcall-summary')).toHaveTextContent('Your 2.2 pick goes to Veteran Hands')
  })

  it('summarises several of the viewer’s keepers by pick label', () => {
    const two = [...locks, { ...locks[0], round: 1, slot: 2, overall: 2, rosterId: 'r2', playerName: 'Second Keeper' }]
    render(<KeeperRollCall locks={two} teamCount={3} currentUserRosterId="r2" />)
    expect(screen.getByTestId('draft-keeper-rollcall-summary')).toHaveTextContent('2 of your picks go to keepers: 1.2, 2.2')
  })

  it('collapses, and remembers it', () => {
    const { unmount } = render(<KeeperRollCall locks={locks} teamCount={3} currentUserRosterId="r2" />)
    const toggle = screen.getByTestId('draft-keeper-rollcall-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle)
    expect(screen.queryByTestId('draft-keeper-rollcall-list')).toBeNull()
    expect(window.localStorage.getItem('af:draft-keeper-rollcall')).toBe('collapsed')
    unmount()
    render(<KeeperRollCall locks={locks} teamCount={3} currentUserRosterId="r2" />)
    expect(screen.queryByTestId('draft-keeper-rollcall-list')).toBeNull()
    expect(screen.getByTestId('draft-keeper-rollcall-toggle')).toHaveAttribute('aria-expanded', 'false')
  })

  it('renders nothing when the draft has no keepers', () => {
    const { container } = render(<KeeperRollCall locks={[]} teamCount={3} currentUserRosterId="r2" />)
    expect(container).toBeEmptyDOMElement()
  })
})
