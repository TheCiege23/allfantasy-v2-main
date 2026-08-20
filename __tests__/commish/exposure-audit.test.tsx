/**
 * 12b — the exposure rules.
 *
 * Two of these are worth locking down because a wrong answer is a wrong *claim*
 * about the user, not just a layout slip: telling a single-league manager they
 * are "overexposed" to their own roster, and calling a healthy player injured.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

import ExposureTable, {
  isInjured,
  isOverexposed,
  OVEREXPOSED_THRESHOLD,
  type ExposureRow,
} from '@/components/exposure/ExposureTable'

function row(over: Partial<ExposureRow> = {}): ExposureRow {
  return {
    playerId: 'p1',
    name: 'P. Nacua',
    position: 'WR',
    team: 'LAR',
    leagueCount: 4,
    leagueNames: ['Dragons', 'Champions', 'Turf Wars', 'Brown Pig'],
    startingCount: 4,
    benchCount: 0,
    irTaxiCount: 0,
    exposurePercent: 4 / 7,
    injuryStatus: null,
    identityResolved: true,
    ...over,
  }
}

describe('isOverexposed — both clauses of the rule', () => {
  it('flags a player in half or more of several leagues', () => {
    expect(isOverexposed(row({ leagueCount: 4 }), 7)).toBe(true)
  })

  it('does not flag a player below the threshold', () => {
    expect(isOverexposed(row({ leagueCount: 3 }), 7)).toBe(false)
  })

  /**
   * ⚠ THE CLAUSE EVERYONE FORGETS. With one connected league every player you
   * roster is in 100% of them. Calling that overexposure tells a user that
   * having a team is a mistake.
   */
  it('never flags anything when the user has only one league', () => {
    expect(isOverexposed(row({ leagueCount: 1 }), 1)).toBe(false)
  })

  it('never flags a player held in exactly one league, however few leagues you have', () => {
    expect(isOverexposed(row({ leagueCount: 1 }), 2)).toBe(false)
  })

  it('uses the shared threshold rather than a local copy', () => {
    // At exactly the threshold the player is over the line, not under it.
    const atLine = Math.ceil(OVEREXPOSED_THRESHOLD * 10)
    expect(isOverexposed(row({ leagueCount: atLine }), 10)).toBe(true)
  })
})

describe('isInjured — only real designations', () => {
  it.each(['Out', 'IR', 'Questionable', 'doubtful', 'Injured Reserve'])('treats %s as injured', (s) => {
    expect(isInjured(s)).toBe(true)
  })

  it.each([null, '', 'Active', 'healthy'])('does not treat %s as injured', (s) => {
    expect(isInjured(s as string | null)).toBe(false)
  })
})

describe('ExposureTable', () => {
  it('shows both tags when a player is overexposed and injured', () => {
    render(
      <ExposureTable
        rows={[row({ injuryStatus: 'Questionable', leagueCount: 4 })]}
        connectedLeagueCount={7}
        filter="all"
      />,
    )
    expect(screen.getByText('Overexposed')).toBeTruthy()
    expect(screen.getByText('Injury risk')).toBeTruthy()
  })

  /** Build rule 4: an unresolved identity keeps its slot and loses its name. */
  it('renders an unnamed slot rather than a guessed name', () => {
    render(
      <ExposureTable
        rows={[row({ identityResolved: false, name: 'sleeper:4034' })]}
        connectedLeagueCount={7}
        filter="all"
      />,
    )
    expect(screen.getByText('Unnamed roster slot')).toBeTruthy()
    expect(screen.queryByText('sleeper:4034')).toBeNull()
  })

  it('breaks the slot split into start / bench / IR rather than one owned bar', () => {
    const { container } = render(
      <ExposureTable
        rows={[row({ startingCount: 2, benchCount: 1, irTaxiCount: 1 })]}
        connectedLeagueCount={7}
        filter="all"
      />,
    )
    const slots = Array.from(container.querySelectorAll('.af-xp-seg')).map((s) => s.getAttribute('data-slot'))
    expect(slots).toEqual(['start', 'bench', 'ir'])
    expect(screen.getByText('2 start · 1 bench · 1 IR')).toBeTruthy()
  })

  /** Build rule 5: a filter hides rows, it never changes what a tag means. */
  it('keeps the overexposed tag identical under a filter', () => {
    const rows = [row({ leagueCount: 4, injuryStatus: 'Out' })]
    const { unmount } = render(<ExposureTable rows={rows} connectedLeagueCount={7} filter="all" />)
    expect(screen.getByText('Overexposed')).toBeTruthy()
    unmount()
    render(<ExposureTable rows={rows} connectedLeagueCount={7} filter="injured" />)
    expect(screen.getByText('Overexposed')).toBeTruthy()
  })
})
