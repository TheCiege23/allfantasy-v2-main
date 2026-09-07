import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, within } from '@testing-library/react'

/*
 * ⚠ THE BOARD NOW RENDERS A CLIENT CHILD THAT NEEDS A ROUTER.
 * `MatchupPulseRefresh` calls `useRouter()`, which throws outside an App Router
 * context — twelve of the thirteen tests below failed on it the moment the
 * indicator was added. The mock is the component's real dependency stated
 * plainly; `refresh` is a spy so the polling behaviour can be asserted rather
 * than assumed.
 */
const routerMock = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => routerMock }))

import { MatchupPulseBoard } from '@/components/core-app/MatchupPulseBoard'
import type { MatchupPulse, PulseRow } from '@/lib/core-app/matchupPulse'

/* The footer's escape hatch back to the full picker; asserted at the bottom. */
const ALL_HREF = '/core/matchup?all=1'

/*
 * The footer's denominator is LEAGUES ON THE ACCOUNT, not claimed teams —
 * `pulse.considered` counts the latter, and a manager with 65 leagues and four
 * claimed teams was being offered "View all 4" from the only route to the
 * picker.
 */
const TOTAL = 9

/*
 * The matchup pulse shipped with no test at all while the my-team board it is
 * modelled on shipped with seventeen. Everything asserted here is a claim the
 * board makes on screen that a reader would act on — a margin they might read
 * as a live score, a count of leagues quietly missing from the list.
 *
 * ⚠ THE "NO CLOCK IS TOUCHED" NOTE THAT USED TO SIT HERE IS NO LONGER TRUE. The
 * board now carries a live-refresh indicator with a poll interval, so the last
 * describe below DOES drive timers. It uses fake timers and a relative advance
 * rather than a wall-clock date, so it still cannot rot with the calendar —
 * which was the point of the original note.
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
    notRanked: { noSchedule: 0, noOpponent: 0, unpriceable: 0, uncomparable: 0, unidentifiedRoster: 0 },
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
        allHref={ALL_HREF}
        totalLeagues={TOTAL}
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
      <MatchupPulseBoard allHref={ALL_HREF} totalLeagues={TOTAL} pulse={pulse({ leading: [row()] })} />,
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
        allHref={ALL_HREF}
        totalLeagues={TOTAL}
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
        allHref={ALL_HREF}
        totalLeagues={TOTAL}
        pulse={pulse({ leading: [row({ margin: 12.4 })], trailing: [row({ leagueId: 'l2', margin: -9.2 })] })}
      />,
    )
    const diffs = [...container.querySelectorAll('.af-mp-diff')].map((e) => e.textContent)
    expect(diffs).toEqual(['+12.4', '−9.2'])
  })

  /* An unnamed opposing roster stays unnamed — never given a placeholder name. */
  it('says the opponent is not named rather than inventing one', () => {
    const { container } = render(
      <MatchupPulseBoard allHref={ALL_HREF} totalLeagues={TOTAL} pulse={pulse({ leading: [row({ opponentName: null })] })} />,
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
      <MatchupPulseBoard allHref={ALL_HREF} totalLeagues={TOTAL} pulse={pulse({ leading: [row({ startersLeft: null })] })} />,
    )
    expect(container.textContent ?? '').not.toMatch(/left to play/)
  })

  /*
   * ...and the mirror of it. A placed lineup that has finished is a real zero
   * and the most useful thing the row can say on a Sunday evening.
   */
  it('states a genuine zero left to play', () => {
    const { container } = render(
      <MatchupPulseBoard allHref={ALL_HREF} totalLeagues={TOTAL} pulse={pulse({ leading: [row({ startersLeft: 0 })] })} />,
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
        allHref={ALL_HREF}
        totalLeagues={TOTAL}
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
      <MatchupPulseBoard allHref={ALL_HREF} totalLeagues={TOTAL} pulse={pulse({ leading: [row({ startersLeft: 6 })] })} />,
    )
    expect(container.querySelector('.af-mp-meta')?.textContent).toBe(
      'vs Gridiron Ghosts · 6 left to play',
    )
  })

  /* Every reason a league is missing gets named — never a silent short list. */
  it('accounts for every league it could not rank', () => {
    const { container } = render(
      <MatchupPulseBoard
        allHref={ALL_HREF}
        totalLeagues={TOTAL}
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
    const none = render(<MatchupPulseBoard allHref={ALL_HREF} totalLeagues={TOTAL} pulse={pulse({ considered: 0, ranked: 0, basis: null })} />)
    expect(none.container.textContent ?? '').toContain('No claimed team yet')

    const some = render(
      <MatchupPulseBoard allHref={ALL_HREF} totalLeagues={TOTAL} pulse={pulse({ considered: 9, ranked: 0, basis: null })} />,
    )
    expect(some.container.textContent ?? '').toContain('None of your 9 claimed teams')
  })

  it('distinguishes the two empty columns instead of showing one blank list', () => {
    const { container } = render(
      <MatchupPulseBoard allHref={ALL_HREF} totalLeagues={TOTAL} pulse={pulse({ ranked: 1, leading: [row()], trailing: [] })} />,
    )
    expect(container.textContent ?? '').toContain('You are not behind in any league right now.')
  })

  it('links each row into that league own matchup screen', () => {
    const { container } = render(<MatchupPulseBoard allHref={ALL_HREF} totalLeagues={TOTAL} pulse={pulse({ leading: [row()] })} />)
    expect(container.querySelector('a.af-mp-row')?.getAttribute('href')).toBe(
      '/core/matchup?league=l1',
    )
  })
})

/*
 * The live-refresh gate.
 *
 * ⚠ THIS IS THE EXPENSIVE DECISION ON THE SCREEN, WHICH IS WHY IT IS TESTED
 * HARDEST. `getMatchupPulse` reads every claimed team across the whole
 * portfolio. Getting `inPlay` wrong in the true direction runs that every twenty
 * seconds for a week whose games finished on Monday; getting it wrong in the
 * false direction leaves a live board frozen at kickoff.
 */
describe('MatchupPulseBoard — live refresh gate', () => {
  const LIVE_MS = 20_000
  const IDLE_MS = 120_000

  function indicator(c: HTMLElement) {
    return c.querySelector('.af-mp-live')
  }

  beforeEach(() => {
    routerMock.refresh.mockClear()
  })

  it('is live when a scored row still has starters to play', () => {
    const { container } = render(
      <MatchupPulseBoard allHref={ALL_HREF} totalLeagues={TOTAL} pulse={pulse({ leading: [row({ basis: 'scored', startersLeft: 6 })] })} />,
    )
    expect(indicator(container)?.getAttribute('data-inplay')).toBe('true')
  })

  /* The finished-week case: scored, but nothing left to move. */
  it('is NOT live when every scored row has no starters left', () => {
    const { container } = render(
      <MatchupPulseBoard
        allHref={ALL_HREF}
        totalLeagues={TOTAL}
        pulse={pulse({
          leading: [row({ basis: 'scored', startersLeft: 0 })],
          trailing: [row({ leagueId: 'l2', basis: 'scored', startersLeft: 0 })],
        })}
      />,
    )
    expect(indicator(container)?.getAttribute('data-inplay')).toBe('false')
  })

  it('is NOT live before kickoff, when every row is a projection', () => {
    const { container } = render(
      <MatchupPulseBoard
        allHref={ALL_HREF}
        totalLeagues={TOTAL}
        pulse={pulse({
          basis: 'projected',
          leading: [row({ basis: 'projected', startersLeft: 10 })],
        })}
      />,
    )
    expect(indicator(container)?.getAttribute('data-inplay')).toBe('false')
  })

  /*
   * ⚠ UNKNOWN IS NOT ZERO. `startersLeft: null` means we could not place the
   * lineup against a fixture list at all. Counting that as "nothing left" would
   * freeze the board for precisely the leagues whose data we hold worst.
   */
  it('treats an unknown starters-left on a scored row as still in play', () => {
    const { container } = render(
      <MatchupPulseBoard
        allHref={ALL_HREF}
        totalLeagues={TOTAL}
        pulse={pulse({ leading: [row({ basis: 'scored', startersLeft: null })] })} />,
    )
    expect(indicator(container)?.getAttribute('data-inplay')).toBe('true')
  })

  it('shows no indicator at all when nothing is ranked', () => {
    const { container } = render(
      <MatchupPulseBoard allHref={ALL_HREF} totalLeagues={TOTAL} pulse={pulse({ considered: 9, ranked: 0, basis: null })} />,
    )
    expect(indicator(container)).toBeNull()
  })

  it('refreshes on the live cadence while games are in play', () => {
    vi.useFakeTimers()
    try {
      render(
        <MatchupPulseBoard
        allHref={ALL_HREF}
        totalLeagues={TOTAL}
          pulse={pulse({ leading: [row({ basis: 'scored', startersLeft: 6 })] })} />,
      )
      expect(routerMock.refresh).not.toHaveBeenCalled()
      act(() => {
        vi.advanceTimersByTime(LIVE_MS)
      })
      expect(routerMock.refresh).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  /*
   * The whole point of the gate: a pre-kickoff board must NOT be re-reading the
   * portfolio on the live cadence. It still polls slowly, which is how it
   * notices kickoff.
   */
  it('does not refresh on the live cadence when nothing is in play', () => {
    vi.useFakeTimers()
    try {
      render(
        <MatchupPulseBoard
        allHref={ALL_HREF}
        totalLeagues={TOTAL}
          pulse={pulse({
            basis: 'projected',
            leading: [row({ basis: 'projected', startersLeft: 10 })],
          })}
        />,
      )
      act(() => {
        vi.advanceTimersByTime(LIVE_MS)
      })
      expect(routerMock.refresh).not.toHaveBeenCalled()
      act(() => {
        vi.advanceTimersByTime(IDLE_MS - LIVE_MS)
      })
      expect(routerMock.refresh).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  /*
   * ⚠ THERE IS NO TEST HERE FOR THE IN-FLIGHT GUARD, AND THAT IS DELIBERATE.
   * `MatchupPulseRefresh` skips a tick while a refresh is still running — worth
   * having, because one refresh measured 13-20 seconds against a 20-second
   * cadence on a 65-league portfolio. But `router.refresh` is mocked here and
   * returns synchronously, so the transition settles before the next tick and
   * `pending` is never true when the guard is read. A test was written for it,
   * passed, and then passed just as happily with the guard deleted — a check
   * that cannot fail. It was removed rather than left to imply coverage it does
   * not give. The guard is justified by measurement in the component, not here.
   */

  /*
   * ⚠ A HIDDEN TAB IS THE EXPENSIVE HALF. Without this the board re-reads the
   * whole portfolio every twenty seconds for a tab nobody is looking at.
   */
  it('does not refresh while the tab is hidden', () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    try {
      render(
        <MatchupPulseBoard
        allHref={ALL_HREF}
        totalLeagues={TOTAL}
          pulse={pulse({ leading: [row({ basis: 'scored', startersLeft: 6 })] })} />,
      )
      act(() => {
        vi.advanceTimersByTime(LIVE_MS * 3)
      })
      expect(routerMock.refresh).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
      vi.useRealTimers()
    }
  })
})

/*
 * 🛑 THIS BLOCK EXISTS BECAUSE THE BOARD SHIPPED THE BUG IT ASSERTS AGAINST, AND
 * A RENDER FOUND IT, NOT A TEST. `matchupPulse` drops a claimed team whose
 * `externalId` is not numeric — an ESPN SWID, a Fantrax slug — because the
 * WeeklyMatchup join needs Sleeper's numeric roster_id. With every team dropped,
 * `considered` was 0 and this board told a manager holding four claimed teams
 * "No claimed team yet".
 */
describe('MatchupPulseBoard — the unidentified-roster gap', () => {
  it('does not claim you have no team when we simply could not use its id', () => {
    const { container } = render(
      <MatchupPulseBoard
        allHref={ALL_HREF}
        totalLeagues={TOTAL}
        pulse={pulse({
          considered: 4,
          ranked: 0,
          basis: null,
          notRanked: {
            noSchedule: 0,
            noOpponent: 0,
            unpriceable: 0,
            uncomparable: 0,
            unidentifiedRoster: 4,
          },
        })}
      />,
    )
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/no claimed team yet/i)
    expect(text).toContain('None of your 4 claimed teams')
    expect(text).toMatch(/roster id we cannot match to a schedule/i)
    /* And it says whose fault it is. */
    expect(text).toMatch(/our gap, not theirs/i)
  })

  it('still says "no claimed team" when there genuinely is none', () => {
    const { container } = render(
      <MatchupPulseBoard
        allHref={ALL_HREF}
        totalLeagues={TOTAL}
        pulse={pulse({ considered: 0, ranked: 0, basis: null })}
      />,
    )
    expect(container.textContent ?? '').toMatch(/no claimed team yet/i)
  })

  /*
   * The footer is the only route left to the league picker on this screen, so
   * its count must be the leagues the user actually holds.
   */
  it('counts the footer against leagues held, not claimed teams', () => {
    const { container } = render(
      <MatchupPulseBoard
        allHref={ALL_HREF}
        totalLeagues={65}
        pulse={pulse({ considered: 4, ranked: 0, basis: null })}
      />,
    )
    expect(container.textContent ?? '').toContain('View all 65')
  })
})
