import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ReceiptsCard } from '@/components/core-app/screens/ReceiptsCard'
import type { DecisionReceiptsData, WaiverReceipt } from '@/lib/core-app/decisionReceipts'

/*
 * Waiver-add receipts as rendered (2026-09-14): what he scored for you, starts, whether he is
 * still yours — and the counts for adds too early to call or with no scores on file, said out
 * loud rather than dropped or shown as 0.
 */

const waiver = (over: Partial<WaiverReceipt> = {}): WaiverReceipt => ({
  id: 'af-ice:9221:3',
  leagueId: 'af-ice',
  leagueName: 'Ice Kings',
  season: 2026,
  week: 3,
  playerId: '9221',
  playerName: 'Jahmyr Gibbs',
  position: 'RB',
  via: 'waiver',
  faab: 12,
  points: 41.2,
  starts: 2,
  weeksScored: 3,
  leftWeek: null,
  href: '/core/waivers?league=af-ice',
  ...over,
})

const data = (over: Partial<DecisionReceiptsData> = {}): DecisionReceiptsData => ({
  trades: [],
  tooEarly: 0,
  uncoveredLeagues: 0,
  waivers: [waiver()],
  waiversTooEarly: 0,
  waiversUnscored: 0,
  ...over,
})

describe('ReceiptsCard — waiver adds', () => {
  it('🛑 an add: who, where, FAAB, points for you, starts, still yours — linked to the league’s waivers', () => {
    render(<ReceiptsCard data={data()} />)
    const link = screen.getByRole('link', { name: 'You added Jahmyr Gibbs (RB)' })
    expect(link.getAttribute('href')).toBe('/core/waivers?league=af-ice')
    expect(screen.getByText('Ice Kings · 2026 wk 3 · $12 FAAB')).toBeTruthy()
    expect(screen.getByText('41.2 pts')).toBeTruthy()
    expect(screen.getByText(/2 starts \(still yours\)/)).toBeTruthy()
  })

  it('a player you let go says when', () => {
    render(<ReceiptsCard data={data({ waivers: [waiver({ leftWeek: 5, starts: 1, faab: null })] })} />)
    expect(screen.getByText(/1 start · gone wk 5/)).toBeTruthy()
    expect(screen.queryByText(/FAAB/)).toBeNull()
  })

  it('🛑 too-early and unscored adds are counted out loud, with no receipt row', () => {
    render(<ReceiptsCard data={data({ waivers: [], waiversTooEarly: 2, waiversUnscored: 1 })} />)
    expect(screen.getByText('2 recent adds are too early to call.')).toBeTruthy()
    expect(screen.getByText('1 add has no weekly scores on file yet.')).toBeTruthy()
    expect(screen.queryByText(/0\.0 pts/)).toBeNull()
  })

  it('trades and waivers together get their own headings', () => {
    const trade = {
      id: 't1', leagueId: 'af-ice', leagueName: 'Ice Kings', season: '2026', week: 2, createdIso: '2026-09-10T00:00:00Z',
      counterparty: 'Rival', got: ['A'], gave: ['B'], gotPoints: 90, gavePoints: 10, netPoints: 80,
      outcome: 'ahead' as const, ongoing: false, unsettledPicks: 0, href: '/core/trades?league=af-ice',
    }
    render(<ReceiptsCard data={data({ trades: [trade] })} />)
    expect(screen.getByRole('heading', { name: 'Trades' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Waiver adds' })).toBeTruthy()
  })

  it('🛑 waivers absent and no trades → nothing rendered (the trade-only card is unchanged)', () => {
    const { container } = render(
      <ReceiptsCard data={{ trades: [], tooEarly: 0, uncoveredLeagues: 0 }} />,
    )
    expect(container.innerHTML).toBe('')
  })
})
