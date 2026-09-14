import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ReceiptsCard } from '@/components/core-app/screens/ReceiptsCard'
import type { DecisionReceiptsData, LineupReceipt } from '@/lib/core-app/decisionReceipts'

/*
 * Lineup receipts as rendered (2026-09-14): points left on the bench stated plainly with the
 * swap that cost them, a perfect week said as perfect, and weeks we could not score or check
 * counted out loud.
 */

const lineup = (over: Partial<LineupReceipt> = {}): LineupReceipt => ({
  id: 'af-ice:5',
  leagueId: 'af-ice',
  leagueName: 'Ice Kings',
  season: 2026,
  week: 5,
  pointsLeft: 14.2,
  perfect: false,
  benched: { name: 'David Montgomery', points: 20.3 },
  started: { name: 'Jameson Williams', points: 6.1 },
  href: '/core/my-team?league=af-ice',
  ...over,
})

const data = (over: Partial<DecisionReceiptsData> = {}): DecisionReceiptsData => ({
  trades: [],
  tooEarly: 0,
  uncoveredLeagues: 0,
  lineups: [lineup()],
  lineupsUnscored: 0,
  lineupsUnreadable: 0,
  ...over,
})

describe('ReceiptsCard — lineups', () => {
  it('🛑 points left on the bench, the league and week, and the swap that cost them — linked to your lineup', () => {
    render(<ReceiptsCard data={data()} />)
    const link = screen.getByRole('link', { name: 'You left 14.2 pts on your bench' })
    expect(link.getAttribute('href')).toBe('/core/my-team?league=af-ice')
    expect(screen.getByText('Ice Kings · 2026 wk 5')).toBeTruthy()
    expect(screen.getByText('Benched David Montgomery (20.3) · started Jameson Williams (6.1)')).toBeTruthy()
  })

  it('a perfect lineup says so, with no swap line', () => {
    const { container } = render(
      <ReceiptsCard data={data({ lineups: [lineup({ perfect: true, pointsLeft: 0, benched: null, started: null })] })} />,
    )
    expect(screen.getByRole('link', { name: 'Perfect lineup in week 5' })).toBeTruthy()
    expect(container.querySelector('.af3a-receipt-swap')).toBeNull()
    expect(container.querySelector('li')?.getAttribute('data-outcome')).toBe('ahead')
  })

  it('🛑 unscored and unreadable weeks are counted out loud, never shown as 0.0', () => {
    render(<ReceiptsCard data={data({ lineups: [], lineupsUnscored: 2, lineupsUnreadable: 1 })} />)
    expect(screen.getByText('2 recent weeks have no weekly scores on file yet.')).toBeTruthy()
    expect(screen.getByText(/1 week couldn’t be checked/)).toBeTruthy()
    expect(screen.queryByText(/0\.0 pts/)).toBeNull()
  })

  it('with another kind present, lineups get their own heading', () => {
    render(<ReceiptsCard data={data({ tooEarly: 1 })} />)
    expect(screen.getByRole('heading', { name: 'Trades' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Lineups' })).toBeTruthy()
  })
})
