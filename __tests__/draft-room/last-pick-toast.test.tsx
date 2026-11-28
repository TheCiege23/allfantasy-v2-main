import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DraftLastPickToast, LAST_PICK_TOAST_MS } from '@/components/app/draft-room/DraftLastPickToast'
import type { DraftPickSnapshot } from '@/lib/live-draft-engine/types'

const slotOrder = [
  { rosterId: 'r1', displayName: 'Ice Breakers' },
  { rosterId: 'r2', displayName: 'Top Shelf' },
]

function pick(overall: number, over: Partial<DraftPickSnapshot> = {}): DraftPickSnapshot {
  return {
    id: `p${overall}`,
    overall,
    round: Math.ceil(overall / 2),
    slot: ((overall - 1) % 2) + 1,
    rosterId: overall % 2 ? 'r1' : 'r2',
    displayName: null,
    playerName: `Player ${overall}`,
    position: 'C',
    team: 'COL',
    byeWeek: null,
    playerId: `pid${overall}`,
    tradedPickMeta: null,
    source: 'user',
    pickLabel: `${Math.ceil(overall / 2)}.0${((overall - 1) % 2) + 1}`,
    ...over,
  }
}

const toast = (picks: DraftPickSnapshot[], active = true, skipRoundOne = true) => (
  <DraftLastPickToast picks={picks} slotOrder={slotOrder} active={active} skipRoundOne={skipRoundOne} />
)

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('last-pick notice', () => {
  it('announces a new pick after round 1 with the team, player, position and team, then fades', () => {
    const base = [pick(1), pick(2)]
    const { rerender } = render(toast(base))
    expect(screen.queryByTestId('draft-last-pick-toast')).toBeNull() // picks already on the board are not news
    rerender(toast([...base, pick(3, { playerName: 'Nathan MacKinnon' })]))
    const t = screen.getByTestId('draft-last-pick-toast')
    expect(t.textContent).toContain('2.01')
    expect(t.textContent).toContain('Ice Breakers took Nathan MacKinnon')
    expect(t.textContent).toContain('C, COL')
    act(() => {
      vi.advanceTimersByTime(LAST_PICK_TOAST_MS + 10)
    })
    expect(screen.queryByTestId('draft-last-pick-toast')).toBeNull()
  })

  it('leaves round 1 to the round-1 card when that card is on, and announces it when it is off', () => {
    const { rerender } = render(toast([]))
    rerender(toast([pick(1)]))
    expect(screen.queryByTestId('draft-last-pick-toast')).toBeNull()
    cleanup()
    const second = render(toast([], true, false))
    second.rerender(toast([pick(1)], true, false))
    expect(screen.getByTestId('draft-last-pick-toast').textContent).toContain('Player 1')
  })

  it('a burst of autopicks shows only the newest', () => {
    const { rerender } = render(toast([pick(1), pick(2)]))
    rerender(toast([pick(1), pick(2), pick(3), pick(4), pick(5)]))
    expect(screen.getByTestId('draft-last-pick-toast').textContent).toContain('Player 5')
  })

  it('says nothing while the draft is not running', () => {
    const { rerender } = render(toast([pick(1), pick(2)], false))
    rerender(toast([pick(1), pick(2), pick(3)], false))
    expect(screen.queryByTestId('draft-last-pick-toast')).toBeNull()
  })
})
