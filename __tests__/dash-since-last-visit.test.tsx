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
      '/league/league-1?view=legacy',
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
