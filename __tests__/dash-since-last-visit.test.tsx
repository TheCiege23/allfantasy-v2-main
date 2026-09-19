import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { DashSinceLastVisit } from '@/components/core-app/screens/DashSinceLastVisit'
import type { SinceLastVisitBrief } from '@/lib/core-app/sinceLastVisit'

/**
 * The brief's render contract: every line links to where the detail lives, a capped
 * trade list never states a count it cannot stand behind, a first visit says why
 * two sections are empty, and a quiet day renders nothing at all.
 */

const NOW = new Date('2026-09-14T15:00:00Z')

function brief(over: Partial<SinceLastVisitBrief> = {}): SinceLastVisitBrief {
  return {
    sinceAt: new Date(NOW.getTime() - 5 * 3_600_000).toISOString(),
    // Same instant as `sinceAt` unless the trades read came back blind and its boundary was held.
    tradesSinceAt: new Date(NOW.getTime() - 5 * 3_600_000).toISOString(),
    firstVisit: false,
    windowCapped: false,
    trades: {
      items: [
        {
          leagueId: 'league-1',
          leagueName: 'Dynasty Gridiron',
          acceptedAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
          summary: 'chxnk got Darren Waller; Hustead got 2027 4th',
        },
      ],
      atLeast: false,
    },
    injuries: [
      { playerId: 'p1', name: 'George Kittle', position: 'TE', from: 'Questionable', to: 'Out', leagues: ['A', 'B'] },
    ],
    standings: [
      {
        leagueId: 'league-1',
        leagueName: 'Dynasty Gridiron',
        wins: 3,
        losses: 1,
        ties: 0,
        won: 1,
        lost: 0,
        tied: 0,
        rank: 3,
        previousRank: 5,
      },
    ],
    alerts: {
      total: 12,
      groups: [
        { type: 'chimmy_alert', label: 'Chimmy alerts', count: 9, latestTitle: 'x' },
        { type: 'player_injury_update', label: 'injury updates', count: 3, latestTitle: 'y' },
      ],
    },
    comparisonPending: false,
    ...over,
  }
}

describe('DashSinceLastVisit', () => {
  it('renders nothing when nothing changed', () => {
    const { container } = render(<DashSinceLastVisit brief={null} now={NOW} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows every kind of change, each linking to where the detail lives', () => {
    render(<DashSinceLastVisit brief={brief()} now={NOW} />)
    expect(screen.getByText('since 5h ago')).toBeTruthy()

    expect(screen.getByText(/1 new trade/)).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Dynasty Gridiron' }).map((a) => a.getAttribute('href'))).toEqual([
      '/league/league-1?view=trades',
      '/core/standings?league=league-1',
    ])

    expect(screen.getByText(/1 injury change on your rosters/)).toBeTruthy()
    expect(screen.getByText('George Kittle')).toBeTruthy()
    expect(screen.getByText(/2 of your leagues/)).toBeTruthy()

    expect(screen.getByText(/went 1–0, now 3–1, up to #3 \(was #5\)/)).toBeTruthy()

    expect(screen.getByText(/12 unread alerts/)).toBeTruthy()
    expect(screen.getByText(/9 Chimmy alerts, 3 injury updates/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open alerts' }).getAttribute('href')).toBe('/core/notifications')
  })

  /* A capped list: the card must not claim exactly N. */
  it('says "3+" when the loaded trade list was capped and every trade in it is new', () => {
    const three = brief().trades.items[0]!
    render(
      <DashSinceLastVisit
        brief={brief({ trades: { items: [three, { ...three, acceptedAt: 'b' }, { ...three, acceptedAt: 'c' }], atLeast: true } })}
        now={NOW}
      />,
    )
    expect(screen.getByText(/3\+ new trades/)).toBeTruthy()
  })

  /*
   * 🛑 THE HEADER AND THE TRADE ROW CAN DESCRIBE DIFFERENT WINDOWS. When a blind trades read left
   * its boundary held further back, the trade rows reach past "since Nh ago" — and they carry no
   * dates of their own, so without this the card states a window its own content does not obey.
   */
  it('says how much further the trade line reaches when its boundary was held back', () => {
    render(
      <DashSinceLastVisit
        brief={brief({ tradesSinceAt: new Date(NOW.getTime() - 26 * 3_600_000).toISOString() })}
        now={NOW}
      />,
    )
    expect(screen.getByText('since 5h ago')).toBeTruthy()
    // The GAP (26h − 5h), not a second absolute label that would have to agree with the header.
    expect(screen.getByText(/\(reaches 21h further back\)/)).toBeTruthy()
  })

  /* And stays quiet in the normal case, where the two are the same instant. */
  it('adds no reach note when the trade line matches the visit window', () => {
    render(<DashSinceLastVisit brief={brief()} now={NOW} />)
    expect(screen.queryByText(/reaches /)).toBeNull()
  })

  /*
   * 🛑 THE DAYS BUCKET IS 24 HOURS WIDE, so two instants that render the same `Nd` can be a day
   * apart. A note built from a second ABSOLUTE label had to be compared against the header's, and
   * every version of that comparison was wrong in a different direction: suppressing on a match
   * hid this case entirely, and dropping to a finer unit printed a SMALLER number than the header.
   * A gap has nothing to compare against.
   */
  it('states a day of held reach that both timestamps round into the same label', () => {
    render(
      <DashSinceLastVisit
        brief={brief({
          sinceAt: new Date(NOW.getTime() - 3570 * 60_000).toISOString(),
          tradesSinceAt: new Date(NOW.getTime() - 5009 * 60_000).toISOString(),
        })}
        now={NOW}
      />,
    )
    // Both timestamps round to `3d`, nearly 24 hours apart.
    expect(screen.getByText('since 3d ago')).toBeTruthy()
    expect(screen.getByText(/\(reaches 24h further back\)/)).toBeTruthy()
  })

  /*
   * 🛑 THE CASE THAT BROKE THE PREVIOUS FORMAT, kept as its regression test. A boundary ONE HOUR
   * further back than a 59.5h window: both round to `3d`, and the "finer unit" form rendered
   * "(last 2d 12h)" — a SMALLER number than the header, for a window that reaches further, because
   * `agoLabel` rounds the day division and the finer form floored it. Measured at 28% of the cases
   * that path fired. Any second absolute label can do this; a gap cannot.
   */
  it('never states a reach that reads smaller than the header', () => {
    render(
      <DashSinceLastVisit
        brief={brief({
          sinceAt: new Date(NOW.getTime() - 3570 * 60_000).toISOString(),
          tradesSinceAt: new Date(NOW.getTime() - 3630 * 60_000).toISOString(),
        })}
        now={NOW}
      />,
    )
    expect(screen.getByText('since 3d ago')).toBeTruthy()
    expect(screen.getByText(/\(reaches 1h further back\)/)).toBeTruthy()
    expect(screen.queryByText(/2d 12h/)).toBeNull()
  })

  /*
   * ⚠ Tests are not typechecked here, so a fixture written before `tradesSinceAt` existed hands
   * over `undefined` and still compiles.
   *
   * 🛑 AND THE ABSENT CASE ALONE DOES NOT PIN THE GUARD — measured. The first version of this
   * test was green with the `Number.isFinite` check deleted, because a `?? brief.sinceAt`
   * fallback made the two values equal and the comparison returned null on its own. The input
   * the guard actually catches is a value that is PRESENT and does not parse.
   */
  it('renders no reach note when sinceAt itself is unparseable', () => {
    /*
     * `reach >= NaN` is false, so guarding only `tradesSinceAt` let NaN through the early return
     * and printed "reaches NaNd further back".
     *
     * ⚠ SCOPED TO THE NOTE. The HEADER still renders "since NaNd ago" here, because `whenLabel`
     * formats `sinceAt` with no guard of its own. That is pre-existing and out of this change's
     * scope; asserting no NaN anywhere would fail on it and make this test about something else.
     */
    const broken = brief({ sinceAt: 'not-a-date', tradesSinceAt: new Date(NOW.getTime() - 9e6).toISOString() })
    render(<DashSinceLastVisit brief={broken} now={NOW} />)
    expect(screen.queryByText(/reaches /)).toBeNull()
  })

  it.each([
    ['missing', undefined],
    ['unparseable', 'not-a-date'],
    /*
     * 🛑 THE ONLY ROW THAT PINS THE `typeof` CHECK. The first two are both caught by
     * `Number.isFinite` on their own — measured: with `typeof` deleted, both still pass. A truthy
     * epoch NUMBER is the shape that defeats it, because it parses to a valid date and would
     * render a confident, wrong reach. Same lesson as the sibling guard in sinceLastVisit, where
     * a `0` in the first version of that test was falsy and caught the old way.
     */
    ['an epoch number', 1_700_000_000_000 as unknown as string],
  ])('renders no reach note at all when the field is %s', (_label, value) => {
    const legacy = brief()
    if (value === undefined) delete (legacy as Partial<SinceLastVisitBrief>).tradesSinceAt
    else legacy.tradesSinceAt = value
    render(<DashSinceLastVisit brief={legacy} now={NOW} />)
    expect(screen.queryByText(/NaN/)).toBeNull()
    expect(screen.queryByText(/reaches /)).toBeNull()
  })

  /*
   * The case that motivated the format change. A boundary trailing by minutes printed
   * "since 2h ago (last 2h)", which reads as a typo, and suppressing it below a one-hour floor
   * lost the information instead. A gap states the small true thing, and needs no threshold.
   */
  it('states a small gap plainly rather than duplicating the header', () => {
    render(
      <DashSinceLastVisit
        brief={brief({
          sinceAt: new Date(NOW.getTime() - 125 * 60_000).toISOString(),
          tradesSinceAt: new Date(NOW.getTime() - 140 * 60_000).toISOString(),
        })}
        now={NOW}
      />,
    )
    expect(screen.getByText('since 2h ago')).toBeTruthy()
    expect(screen.getByText(/\(reaches 15m further back\)/)).toBeTruthy()
  })

  it('on a first visit, explains why injury and standings changes are not shown yet', () => {
    render(<DashSinceLastVisit brief={brief({ firstVisit: true, windowCapped: true, injuries: [], standings: [], comparisonPending: true })} now={NOW} />)
    expect(screen.getByText('last 7 days')).toBeTruthy()
    expect(screen.getByText(/appear from your next visit/)).toBeTruthy()
  })

  /* A closed <details> hides content from every visibility check; the brief must start open. */
  it('starts open', () => {
    const { container } = render(<DashSinceLastVisit brief={brief()} now={NOW} />)
    expect(container.querySelector('details')?.hasAttribute('open')).toBe(true)
  })
})
