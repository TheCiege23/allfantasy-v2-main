/**
 * 🛑 A SEALED JURY VOTE SHOWS NO COUNT.
 *
 * The server sends no vote data until every juror has voted (`FinaleRevealView.sealed`), yet the finalist
 * tally printed "0" beside every finalist — "0 jury votes" to a screen reader, "Jury votes 0" on desktop —
 * read as "nobody has voted for you" before anyone could know (2026-11-07 Survivor audit). Sealed now says
 * so; the revealed tally is unchanged.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

vi.mock('@/components/survivor/late/lateUi', async (orig) => ({
  ...(await orig<typeof import('@/components/survivor/late/lateUi')>()),
  useIsPhone: () => false,
  usePrefersReducedMotion: () => true,
}))

import { JuryFinaleView } from '@/components/survivor/late/JuryFinale'
import type { FinaleRevealView } from '@/lib/survivor/finaleView'

const BASE: FinaleRevealView = {
  leagueName: 'Island', week: 14, finalistCount: 2, open: true, sealed: true, votingDeadline: null, juryCount: 3,
  jury: [{ rosterId: 'j1', name: 'Lee', votedOutWeek: 10 }],
  finalists: [
    { rosterId: 'a', name: 'Ciege', record: { immunityWins: 3, idolsPlayed: 1, seasonPoints: 1488.2, votesSurvived: 4 } },
    { rosterId: 'b', name: 'Morgan', record: { immunityWins: 1, idolsPlayed: 0, seasonPoints: 1521.6, votesSurvived: 2 } },
  ],
  viewer: { rosterId: 'a', isJuror: false, isFinalist: true, myVoteFinalistRosterId: null },
  tiebreakRule: 'Most season points', reveal: null, champion: null,
}

afterEach(() => cleanup())

describe('Final Tribal Council tally', () => {
  it('says the votes are sealed, and shows no "0"', () => {
    const { container } = render(<JuryFinaleView view={BASE} />)
    const finalists = [...container.querySelectorAll('.svl-finalist')]
    expect(finalists).toHaveLength(2)
    for (const card of finalists) {
      expect(card.textContent).toContain('Sealed')
      expect(card.querySelector('[aria-label$="jury votes"], [aria-label$="jury vote"]')).toBeNull()
    }
  })

  // Control: once revealed, the tally (and its number) is back.
  it('shows the count once the vote is revealed', () => {
    const view: FinaleRevealView = {
      ...BASE, sealed: false, open: false,
      reveal: {
        slips: [
          { index: 0, finalistRosterId: 'a', kind: 'jury', label: 'Lee' },
          { index: 1, finalistRosterId: 'a', kind: 'jury', label: 'Sam' },
          { index: 2, finalistRosterId: 'b', kind: 'jury', label: 'Taylor' },
        ],
        voteCount: { a: 2, b: 1 }, winnerRosterId: 'a', tieBreakSeasonPoints: null, scoreline: '2–1',
      },
    }
    const { container } = render(<JuryFinaleView view={view} />)
    expect(container.textContent).not.toContain('Sealed')
    // The count builds as the slips are read (from 0), so assert the tally itself is back on every card.
    for (const card of container.querySelectorAll('.svl-finalist')) {
      expect(card.querySelector('[aria-label$="jury votes"], [aria-label$="jury vote"]')).not.toBeNull()
    }
  })
})
