import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, within } from '@testing-library/react'

import { MatchupPulseBoard } from '@/components/core-app/MatchupPulseBoard'
import type { MatchupPulse, PulseRow } from '@/lib/core-app/matchupPulse'

/*
 * The matchup pulse shipped with no test at all while the my-team board it is
 * modelled on shipped with seventeen. Everything asserted here is a claim the
 * board makes on screen that a reader would act on — a margin they might read
 * as a live score, a count of leagues quietly missing from the list.
 *
 * No clock is touched: this board renders no countdown, so nothing here can rot
 * with the calendar the way the my-team screen suite once did.
 */

function row(over: Partial<PulseRow> = {}): PulseRow {
  return {
    leagueId: 'l1',
    leagueName: 'Dynasty Warriors',
    platform: 'sleeper',
    logoUrl: null,
    leagueBadge: 'DW',
    opponentName: 'Gridiron Ghosts',
    opponentAvatarUrl: null,
    opponentInitials: 'GG',
    margin: 12.4,
    basis: 'scored',
    season: 2026,
    week: 2,
    startersLeft: 6,
    coverage: null,
    href: '/core/matchup?league=l1',
    ...over,
  }
}

function pulse(over: Partial<MatchupPulse> = {}): MatchupPulse {
  return {
    leading: [],
    trailing: [],
    considered: 1,
    ranked: 1,
    basis: 'scored',
    notRanked: { noSchedule: 0, noOpponent: 0, unpriceable: 0, uncomparable: 0 },
    ...over,
  }
}

describe('MatchupPulseBoard', () => {
  /*
   * ⚠ THE SINGLE MOST IMPORTANT ASSERTION IN THIS FILE. A projected margin
   * rendered identically to a live one is indistinguishable from a score, and
   * before week 1 every row on this board is a projection.
   */
  it('tags a projected row so it cannot be read as a live score', () => {
    const { container } = render(
      <MatchupPulseBoard
        pulse={pulse({
          basis: 'projected',
          leading: [row({ basis: 'projected', margin: 8.1 })],
        })}
      />,
    )
    expect(within(container).getByText('PROJ')).toBeTruthy()
    expect(container.textContent ?? '').toMatch(/not a live score/i)
  })

  it('leaves a scored row untagged and says nothing about projections', () => {
    const { container } = render(
      <MatchupPulseBoard pulse={pulse({ leading: [row()] })} />,
    )
    expect(within(container).queryByText('PROJ')).toBeNull()
    expect(container.textContent ?? '').not.toMatch(/projection/i)
  })

  /*
   * A mixed board is the normal mid-season state — some leagues playing
   * Thursday, others not until Sunday. A header note cannot tell you WHICH of
   * ten rows is the projection, so the per-row tag has to survive.
   */
  it('tags only the projected rows on a mixed board', () => {
    const { container } = render(
      <MatchupPulseBoard
        pulse={pulse({
          basis: 'mixed',
          leading: [row({ leagueId: 'a', basis: 'scored' }), row({ leagueId: 'b', basis: 'projected' })],
        })}
      />,
    )
    expect(container.querySelectorAll('.af-mp-tag')).toHaveLength(1)
    expect(container.textContent ?? '').toMatch(/Rows tagged PROJ/i)
  })

  it('signs the margin by side rather than repeating a bare number', () => {
    const { container } = render(
      <MatchupPulseBoard
        pulse={pulse({ leading: [row({ margin: 12.4 })], trailing: [row({ leagueId: 'l2', margin: -9.2 })] })}
      />,
    )
    const diffs = [...container.querySelectorAll('.af-mp-diff')].map((e) => e.textContent)
    expect(diffs).toEqual(['+12.4', '−9.2'])
  })

  /* An unnamed opposing roster stays unnamed — never given a placeholder name. */
  it('says the opponent is not named rather than inventing one', () => {
    const { container } = render(
      <MatchupPulseBoard pulse={pulse({ leading: [row({ opponentName: null })] })} />,
    )
    expect(container.textContent ?? '').toContain('opponent not named')
  })

  /*
   * ⚠ NULL IS NOT ZERO. Null means we could not place this lineup against a
   * fixture list at all; rendering it as "0 left to play" tells a manager their
   * week is over before it has started.
   */
  it('omits the left-to-play clause when it could not be measured', () => {
    const { container } = render(
      <MatchupPulseBoard pulse={pulse({ leading: [row({ startersLeft: null })] })} />,
    )
    expect(container.textContent ?? '').not.toMatch(/left to play/)
  })

  /*
   * ...and the mirror of it. A placed lineup that has finished is a real zero
   * and the most useful thing the row can say on a Sunday evening.
   */
  it('states a genuine zero left to play', () => {
    const { container } = render(
      <MatchupPulseBoard pulse={pulse({ leading: [row({ startersLeft: 0 })] })} />,
    )
    expect(container.textContent ?? '').toContain('0 left to play')
  })

  /*
   * ⚠ THIS ASSERTS AN ABSENCE, AND THE ABSENCE IS THE DESIGN. An earlier cut of
   * this suite expected the row to disclose "priced 8/10 v 10/10". It does not,
   * and should not: the loader REFUSES to rank a pairing whose two lineups are
   * not the same size and fully priced — a margin between unequally covered
   * totals is not a margin, and one such pair produced "+120.5" purely because
   * the other roster was half-stored. Those leagues are counted in
   * `notRanked.uncomparable` instead, which the gap note reports.
   *
   * So a row that reaches the board is already like-for-like, and printing a
   * fraction beside it would imply a doubt that ranking has already resolved.
   */
  it('renders no coverage fraction, because a ranked row is always like-for-like', () => {
    const { container } = render(
      <MatchupPulseBoard
        pulse={pulse({
          basis: 'projected',
          leading: [
            row({
              basis: 'projected',
              coverage: { you: { from: 10, of: 10 }, them: { from: 10, of: 10 } },
            }),
          ],
        })}
      />,
    )
    const meta = container.querySelector('.af-mp-meta')?.textContent ?? ''
    expect(meta).not.toMatch(/\d+\s*\/\s*\d+/)
    expect(meta).toContain('vs Gridiron Ghosts')
  })

  /*
   * The row meta is exactly two clauses and nothing else. Worth pinning: this is
   * the line that would quietly grow a qualifier the ranking rule has already
   * made untrue.
   */
  it('keeps the row meta to the opponent and the play count', () => {
    const { container } = render(
      <MatchupPulseBoard pulse={pulse({ leading: [row({ startersLeft: 6 })] })} />,
    )
    expect(container.querySelector('.af-mp-meta')?.textContent).toBe(
      'vs Gridiron Ghosts · 6 left to play',
    )
  })

  /* Every reason a league is missing gets named — never a silent short list. */
  it('accounts for every league it could not rank', () => {
    const { container } = render(
      <MatchupPulseBoard
        pulse={pulse({
          considered: 12,
          ranked: 2,
          leading: [row()],
          notRanked: { noSchedule: 4, noOpponent: 3, unpriceable: 2, uncomparable: 1 },
        })}
      />,
    )
    const text = container.textContent ?? ''
    expect(text).toContain('4 carry no schedule')
    expect(text).toContain('3 have no game this week')
    expect(text).toContain('2 could not be scored or priced')
    expect(text).toContain('1 have lineups we cannot compare like for like')
  })

  it('tells no-claimed-team apart from nothing-rankable', () => {
    const none = render(<MatchupPulseBoard pulse={pulse({ considered: 0, ranked: 0, basis: null })} />)
    expect(none.container.textContent ?? '').toContain('No claimed team yet')

    const some = render(
      <MatchupPulseBoard pulse={pulse({ considered: 9, ranked: 0, basis: null })} />,
    )
    expect(some.container.textContent ?? '').toContain('None of your 9 leagues')
  })

  it('distinguishes the two empty columns instead of showing one blank list', () => {
    const { container } = render(
      <MatchupPulseBoard pulse={pulse({ ranked: 1, leading: [row()], trailing: [] })} />,
    )
    expect(container.textContent ?? '').toContain('You are not behind in any league right now.')
  })

  it('links each row into that league own matchup screen', () => {
    const { container } = render(<MatchupPulseBoard pulse={pulse({ leading: [row()] })} />)
    expect(container.querySelector('a.af-mp-row')?.getAttribute('href')).toBe(
      '/core/matchup?league=l1',
    )
  })
})
