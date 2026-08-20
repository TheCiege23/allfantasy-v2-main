/**
 * 11d — `RivalryCard`.
 *
 * ⚠ SAME REASON AS THE INTEGRITY SUITE: THERE IS NO PRODUCTION DATA. Measured
 * while building this screen, `rivalry_records` holds **zero rows** across the
 * whole production database — the rivalry engine has never been run against a
 * real league, so this card cannot be checked by looking at the app.
 *
 * The rule worth protecting is the colour contract: only genuinely rare stats
 * are tinted. Tint the routine chips and the eye stops finding the elimination,
 * which is the only reason the row exists.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

import RivalryCard from '@/components/commish/RivalryCard'
import type { RivalryBoardRow } from '@/lib/rivalry-engine/rivalryBoard'

function row(over: Partial<RivalryBoardRow> = {}): RivalryBoardRow {
  return {
    id: 'riv-1',
    teamAName: 'Turf Tyrants',
    teamBName: 'Dynasty Dragons',
    rivalryScore: 91,
    tier: 'blood_feud',
    chips: [
      { label: '14 H2H MEETINGS', tone: 'neutral' },
      { label: '6 CLOSE GAMES', tone: 'neutral' },
      { label: '1 ELIMINATION', tone: 'warn' },
    ],
    context: 'Turf Tyrants hold an 8–6 head-to-head edge.',
    ...over,
  }
}

describe('RivalryCard', () => {
  it('renders both team names and the score', () => {
    // The heading is one element with a `vs` span inside, so match on the heading.
    render(<RivalryCard row={row()} featured />)
    expect(screen.getByRole('heading').textContent).toBe('Turf Tyrants vs Dynasty Dragons')
    expect(screen.getByText('91')).toBeTruthy()
  })

  it('tints only the rare stat, leaving routine chips neutral', () => {
    const { container } = render(<RivalryCard row={row()} />)
    const chips = Array.from(container.querySelectorAll('.af-cm-rchip'))
    const tinted = chips.filter((c) => c.getAttribute('data-tone') === 'warn').map((c) => c.textContent)
    expect(tinted).toEqual(['1 ELIMINATION'])
  })

  /**
   * Build rule 1: the score never ships bare. A record whose events have not been
   * rebuilt must say so rather than presenting a naked, unjustified number.
   */
  it('explains itself rather than showing a lone score when no chips resolved', () => {
    render(<RivalryCard row={row({ chips: [], context: null })} />)
    expect(screen.getByText(/supporting history has not been rebuilt/)).toBeTruthy()
  })

  it('only the featured card carries the accent treatment', () => {
    const { container: a } = render(<RivalryCard row={row()} featured />)
    const { container: b } = render(<RivalryCard row={row({ id: 'riv-2' })} />)
    expect(a.querySelector('[data-featured="true"]')).toBeTruthy()
    expect(b.querySelector('[data-featured="true"]')).toBeNull()
  })
})
