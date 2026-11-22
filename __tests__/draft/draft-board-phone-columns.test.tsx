/**
 * Phone Board tab (2026-10-29), on top of main's Sleeper-style board (90d917b41). Measured at Pixel 7
 * size on that board: below sm the grid is `min-w-max`, where a `1fr` track grows to its longest
 * content, so columns were ~157px (2.6 teams visible) under 215px of title/legend/explainer. With the
 * phone-only `--af-board-col-max` cap and the header extras hidden: 82px columns, 5 teams, 130px above
 * round 1, 8.8 rounds visible. Desktop measured identical (97px columns, 62px above round 1).
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DraftBoard } from '@/components/app/draft-room/DraftBoard'

afterEach(cleanup)

const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/)
const boardSrc = readFileSync(resolve(__dirname, '../../components/app/draft-room/DraftBoard.tsx'), 'utf8')

describe('DraftBoard on a phone', () => {
  const slotOrder = [1, 2, 3].map((slot) => ({ slot, rosterId: `r${slot}`, displayName: `Team ${slot}` }))

  it('column tracks read a cap that only phones set; md+ falls back to minmax(84px, 1fr)', () => {
    expect(boardSrc).toMatch(/^const BOARD_COLUMN = 'minmax\(84px, var\(--af-board-col-max, 1fr\)\)'$/m)
    render(<DraftBoard picks={[]} slotOrder={slotOrder} teamCount={3} rounds={2} draftType="snake" thirdRoundReversal={false} />)
    expect(classes(screen.getByTestId('draft-board-grid'))).toContain('max-md:[--af-board-col-max:84px]')
  })

  it('hides the title, legend and round explainer below md and keeps the round controls', () => {
    render(<DraftBoard picks={[]} slotOrder={slotOrder} teamCount={3} rounds={2} draftType="snake" thirdRoundReversal={false} currentUserRosterId="r1" />)
    expect(classes(screen.getByTestId('draft-board-legend'))).toContain('max-md:hidden')
    expect(classes(screen.getByTestId('draft-board-round-label'))).toContain('max-md:hidden')
    expect(classes(screen.getByText('Draft board'))).toContain('max-md:hidden')
    expect(classes(screen.getByTestId('draft-board-round-selector'))).not.toContain('max-md:hidden')
  })
})
