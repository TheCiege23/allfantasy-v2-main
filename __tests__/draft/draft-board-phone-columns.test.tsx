/**
 * Phone Board tab (2026-10-29). Measured at Pixel 7 size before: 183px columns (a `1fr` track under
 * `min-w-max` grows to the longest team name), 2.3 teams visible, 215px of title/legend/explainer
 * above round 1, and filled cells reading "Nik…" beside a headshot. After: 82px columns, 5 teams
 * visible, 130px above round 1, 7.8 rounds visible, and cells show the last name. Desktop measured
 * identical (183px columns, 62px above round 1) because the custom properties are unset at md+.
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DraftBoard } from '@/components/app/draft-room/DraftBoard'
import { boardShortName } from '@/components/app/draft-room/DraftBoardCell'

afterEach(cleanup)

const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/)

describe('boardShortName', () => {
  it('keeps everything after the first name, and a one-word name whole', () => {
    expect(boardShortName('Nikola Jokic')).toBe('Jokic')
    expect(boardShortName('Shai Gilgeous-Alexander')).toBe('Gilgeous-Alexander')
    expect(boardShortName('Gary Payton II')).toBe('Payton II')
    expect(boardShortName('Nene')).toBe('Nene')
    expect(boardShortName('  ')).toBe('')
    expect(boardShortName(null)).toBe('')
  })
})

describe('DraftBoard on a phone', () => {
  const slotOrder = [1, 2, 3].map((slot) => ({ slot, rosterId: `r${slot}`, displayName: `Team ${slot}` }))
  const picks = [{
    id: 'k1', overall: 1, round: 1, slot: 1, rosterId: 'r1', displayName: 'Team 1', playerName: 'Nikola Jokic', position: 'C',
    team: 'DEN', byeWeek: null, playerId: 'p1', tradedPickMeta: null, source: 'user', pickLabel: '1.01', createdAt: new Date(0).toISOString(),
  }]

  it('caps columns with phone-only custom properties and hides the header extras below md', () => {
    render(<DraftBoard picks={picks} slotOrder={slotOrder} teamCount={3} rounds={2} draftType="snake" thirdRoundReversal={false} currentUserRosterId="r1" />)
    const grid = screen.getByTestId('draft-board-grid')
    expect(classes(grid)).toEqual(expect.arrayContaining(['min-w-max', 'max-md:[--af-board-col-min:84px]', 'max-md:[--af-board-col-max:84px]']))
    expect(classes(screen.getByTestId('draft-board-legend'))).toContain('max-md:hidden')
    expect(classes(screen.getByTestId('draft-board-round-label'))).toContain('max-md:hidden')
    // Round controls are what stays on a phone.
    expect(classes(screen.getByTestId('draft-board-round-selector'))).not.toContain('max-md:hidden')
  })

  it('shows the last name on a phone and the full name with headshot at md+', () => {
    render(<DraftBoard picks={picks} slotOrder={slotOrder} teamCount={3} rounds={2} draftType="snake" thirdRoundReversal={false} />)
    const short = screen.getByTestId('draft-board-cell-1-short-name')
    expect(short.textContent).toBe('Jokic')
    expect(classes(short)).toContain('md:hidden')
    expect(short.getAttribute('title')).toBe('Nikola Jokic')
    const full = [...screen.getByTestId('draft-board-cell-1').querySelectorAll('span')].find((el) => el.textContent === 'Nikola Jokic')!
    expect(classes(full)).toContain('max-md:hidden')
  })
})
