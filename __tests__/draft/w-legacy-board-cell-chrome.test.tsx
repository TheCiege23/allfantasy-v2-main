import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DraftBoard } from '@/app/draft/components/DraftBoard'
import type { DraftPickRecord } from '@/app/draft/types'

const order = [{ id: 'one', label: 'Manager One' }, { id: 'two', label: 'Manager Two', isCpu: true }]
beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} })))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const pick = (overrides: Partial<DraftPickRecord> = {}): DraftPickRecord => ({
  id: 'pick-3', round: 2, pickNumber: 1, overallPick: 3, originalOwnerId: 'two', currentOwnerId: 'two',
  playerId: null, playerName: 'Example Player', position: 'WR', team: 'FA',
  isTraded: false, autopicked: false, timestamp: '', ...overrides,
})

describe('older mock route uses the canonical board', () => {
  it('shows a round-two pick in its original manager column and advances the clock', () => {
    render(<DraftBoard numTeams={2} numRounds={2} pickOrder={order} picks={[pick()]} currentOverall={4} />)
    const cell = screen.getByTestId('draft-board-cell-3')
    expect(cell).toHaveTextContent('Example Player')
    expect(cell).toHaveAttribute('data-slot', '2')
    expect(cell).toHaveAttribute('data-owner-roster', 'two')
    expect(screen.getByTestId('draft-board-cell-4')).toHaveAttribute('data-current', 'true')
  })

  it('preserves the new owner on a traded, unfilled pick', () => {
    render(<DraftBoard numTeams={2} numRounds={2} pickOrder={order}
      picks={[pick({ playerName: null, position: null, currentOwnerId: 'one', isTraded: true })]} currentOverall={3} />)
    expect(screen.getByTestId('draft-board-cell-3')).toHaveAttribute('data-owner-roster', 'one')
    expect(screen.getByTestId('draft-board-cell-3')).toHaveAccessibleName(/empty slot/)
  })

  it('renders a completed board without an on-clock pick or a second board implementation', () => {
    render(<DraftBoard numTeams={2} numRounds={2} pickOrder={order} picks={[pick()]} currentOverall={5} />)
    expect(screen.getAllByTestId('draft-board')).toHaveLength(1)
    expect(screen.getByTestId('legacy-draft-board').querySelectorAll('[data-current="true"]')).toHaveLength(0)
  })
})
