/**
 * The board follows the live pick until the manager looks elsewhere (components/app/draft-room/DraftBoard.tsx).
 *
 * Yahoo's 2026 room "kept reverting back to the original position": every pick dragged the board
 * back to the current cell, so nobody could study another column mid-draft. Here a wheel, swipe or
 * round change pauses following; "Back to live pick" resumes it and scrolls there at once.
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/app/draft-room/LazyDraftImage', () => ({ LazyDraftImage: () => null }))

import { DraftBoard } from '@/components/app/draft-room/DraftBoard'

const scrolled: string[] = []

beforeEach(() => {
  scrolled.length = 0
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  // Run animation frames synchronously so each effect's scroll lands inside act().
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.getAttribute('data-testid') ?? '')
  }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const board = (current: number) => (
  <DraftBoard
    picks={[]}
    slotOrder={[1, 2, 3, 4].map((slot) => ({ slot, rosterId: `r-${slot}`, displayName: `Team ${slot}` }))}
    teamCount={4}
    rounds={3}
    draftType="snake"
    thirdRoundReversal={false}
    currentOverallPick={current}
  />
)

describe('draft board: follow the live pick', () => {
  it('follows each new pick while the manager has not looked away', () => {
    const { rerender } = render(board(2))
    rerender(board(3))
    expect(scrolled.at(-1)).toBe('draft-board-cell-3')
    expect(screen.queryByTestId('draft-board-follow-live')).toBeNull()
  })

  it('a scroll by the manager stops the board pulling them back, until they ask', () => {
    const { rerender } = render(board(2))
    act(() => {
      fireEvent.wheel(screen.getByTestId('draft-board'))
    })
    const before = scrolled.length
    rerender(board(3))
    rerender(board(4))
    expect(scrolled.length).toBe(before) // not dragged back
    const resume = screen.getByTestId('draft-board-follow-live')
    expect(resume.textContent).toContain('#4')

    act(() => {
      fireEvent.click(resume)
    })
    expect(scrolled.at(-1)).toBe('draft-board-cell-4')
    expect(screen.queryByTestId('draft-board-follow-live')).toBeNull()
    rerender(board(5))
    expect(scrolled.at(-1)).toBe('draft-board-cell-5') // following again
  })

  it('choosing another round by hand also pauses following', () => {
    const { rerender } = render(board(2))
    act(() => {
      fireEvent.click(screen.getByTestId('draft-board-next-round'))
    })
    const before = scrolled.length
    rerender(board(3))
    expect(scrolled.length).toBe(before)
    expect(screen.getByTestId('draft-board-follow-live')).toBeTruthy()
  })
})
