import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The draft board on a phone (2026-11-25, the simplify pass).
 */
vi.mock('@/components/app/draft-room/LazyDraftImage', () => ({
  default: () => null,
  LazyDraftImage: () => null,
}))

import { DraftBoardCell, type DraftBoardCellPick } from '@/components/app/draft-room/DraftBoardCell'

afterEach(cleanup)

const pick = (overall: number): DraftBoardCellPick =>
  ({ overall, round: 1, slot: overall, pickLabel: `1.0${overall}`, playerName: '', position: '', team: '', ownerRosterId: 'r1' }) as DraftBoardCellPick

function classes(el: Element): string[] {
  return (el.getAttribute('class') ?? '').split(/\s+/)
}

describe('draft board on a phone', () => {
  it('another team’s empty pick keeps its trade button for md+ only', () => {
    render(<DraftBoardCell pick={pick(7)} isEmpty onTradeFromCell={() => {}} />)
    const c = classes(screen.getByTestId('draft-board-cell-trade-7'))
    expect(c).toContain('hidden')
    expect(c).toContain('md:inline-flex')
  })

  it('the viewer’s own pick shows its trade button on a phone too', () => {
    render(<DraftBoardCell pick={pick(8)} isEmpty isOwnPick onTradeFromCell={() => {}} />)
    const c = classes(screen.getByTestId('draft-board-cell-trade-8'))
    expect(c).toContain('inline-flex')
    expect(c).not.toContain('hidden')
  })

  it('the board passes whose pick it is, at both of its cell renderers', () => {
    const src = readFileSync(resolve(process.cwd(), 'components/app/draft-room/DraftBoard.tsx'), 'utf8')
    expect(src.match(/isOwnPick=\{Boolean\(currentUserRosterId && pick\.ownerRosterId === currentUserRosterId\)\}/g)).toHaveLength(2)
  })

  it('the phone clock bar no longer repeats "You are on the clock"', () => {
    const src = readFileSync(resolve(process.cwd(), 'components/app/draft-room/DraftRoomPageClient.tsx'), 'utf8')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    expect(src).not.toContain('draft-mobile-you-on-clock')
    expect(src).not.toContain('draftRoomCopy.clockBarYouOnClock')
    // The picks-until line is still there for when it is not your turn.
    expect(src).toContain('draft-mobile-picks-until-you')
  })
})
