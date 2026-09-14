import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ReceiptsCard } from '@/components/core-app/screens/ReceiptsCard'
import type { DecisionReceiptsData, TradeReceipt } from '@/lib/core-app/decisionReceipts'

/*
 * The home Receipts card as rendered (2026-09-14): wins and losses in the same plain words,
 * points never a letter, too-early trades counted, and nothing on the home when there is
 * nothing to say.
 */

const receipt = (over: Partial<TradeReceipt> = {}): TradeReceipt => ({
  id: 't1',
  leagueId: 'af-1',
  leagueName: 'Ice Kings',
  season: '2026',
  week: 3,
  createdIso: '2026-09-10T00:00:00.000Z',
  counterparty: 'Gridiron Vultures',
  got: ['Jahmyr Gibbs'],
  gave: ['Sam LaPorta'],
  gotPoints: 88.4,
  gavePoints: 20,
  netPoints: 68.4,
  outcome: 'ahead',
  ongoing: false,
  unsettledPicks: 0,
  href: '/core/trades?league=af-1',
  ...over,
})

const data = (over: Partial<DecisionReceiptsData> = {}): DecisionReceiptsData => ({
  trades: [receipt()],
  tooEarly: 0,
  uncoveredLeagues: 0,
  ...over,
})

describe('ReceiptsCard', () => {
  it('🛑 renders nothing when there is nothing to say', () => {
    expect(render(<ReceiptsCard data={null} />).container.innerHTML).toBe('')
    expect(render(<ReceiptsCard data={data({ trades: [] })} />).container.innerHTML).toBe('')
  })

  it('a winning trade: who, where, the swap, the points, and "you’re ahead" — linked to the league’s trades', () => {
    render(<ReceiptsCard data={data()} />)
    const link = screen.getByRole('link', { name: 'Your trade with Gridiron Vultures' })
    expect(link.getAttribute('href')).toBe('/core/trades?league=af-1')
    expect(screen.getByText('Ice Kings · 2026 wk 3')).toBeTruthy()
    expect(screen.getByText('Gave Sam LaPorta · got Jahmyr Gibbs')).toBeTruthy()
    expect(screen.getByText('+68.4 pts')).toBeTruthy()
    expect(screen.getByText(/you’re ahead/)).toBeTruthy()
  })

  it('🛑 a losing trade says "you’re behind" with the minus sign — no softening, no letter', () => {
    const { container } = render(<ReceiptsCard data={data({ trades: [receipt({ netPoints: -85, outcome: 'behind' })] })} />)
    expect(screen.getByText('−85.0 pts')).toBeTruthy()
    expect(screen.getByText(/you’re behind/)).toBeTruthy()
    expect(container.querySelector('li')?.getAttribute('data-outcome')).toBe('behind')
    expect(screen.queryByText(/\b[ABCDF]\b grade/)).toBeNull()
  })

  it('still-counting, undrafted picks, too-early and uncovered leagues are all said out loud', () => {
    render(
      <ReceiptsCard
        data={data({ trades: [receipt({ ongoing: true, unsettledPicks: 2 })], tooEarly: 1, uncoveredLeagues: 3 })}
      />,
    )
    expect(screen.getByText(/\(still counting\)/)).toBeTruthy()
    expect(screen.getByText('2 picks not drafted yet — not counted')).toBeTruthy()
    expect(screen.getByText('1 newer trade is too early to call.')).toBeTruthy()
    expect(screen.getByText('Trade receipts cover your Sleeper leagues for now.')).toBeTruthy()
  })

  it('only too-early trades still gets a card that says so', () => {
    render(<ReceiptsCard data={data({ trades: [], tooEarly: 2 })} />)
    expect(screen.getByText('2 newer trades are too early to call.')).toBeTruthy()
  })
})
