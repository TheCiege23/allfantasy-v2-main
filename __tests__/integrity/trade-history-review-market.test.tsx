import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import TradeHistoryReview from '@/components/commish/TradeHistoryReview'

afterEach(cleanup)

const rows = [{ tradeKey: 'sleeper:t', sideATeamId: '1', sideBTeamId: '2', sideAName: 'Gridiron', sideBName: 'Waivers', sideAGave: ['Vet Back'], sideBGave: ['2027 1st'], sideAValue: 3000, sideBValue: 5000, gapPct: 47, basis: 'trade_date', completedAt: '2026-10-20T12:00:00Z' }]
const view = (marketContext?: Record<string, string[]>) => ({ ready: true, rows, teams: [{ teamId: '1', name: 'Gridiron', trades: 1 }], pairs: [], marketContext })

describe('the trade history review, against the market', () => {
  it('shows the market facts under the trade they belong to', () => {
    render(<TradeHistoryReview leagueId="L" view={view({ 'sleeper:t': ['At the trade, Gridiron was 7-2 (.778) and Waivers was 2-6-1 (.278).'] })} />)
    expect(screen.getByTestId('trade-audit-market').textContent).toContain('Against the market')
    expect(screen.getByText(/Gridiron was 7-2/)).toBeTruthy()
  })

  it('no market facts, no block', () => {
    render(<TradeHistoryReview leagueId="L" view={view()} />)
    expect(screen.queryByTestId('trade-audit-market')).toBeNull()
  })

  it('frequent partners: their gap together, beside each team\'s gap elsewhere', () => {
    const pair = { teamIds: ['1', '2'] as [string, string], names: ['Gridiron', 'Waivers'] as [string, string], count: 5, expected: 0.4, outside: 2, netShareToFirst: 0.2, gapTogether: 38, elsewhere: [{ trades: 6, gap: 7 }, { trades: 1, gap: null }] as [{ trades: number; gap: number | null }, { trades: number; gap: number | null }] }
    render(<TradeHistoryReview leagueId="L" view={{ ...view(), pairs: [pair] }} />)
    const text = screen.getByTestId('trade-audit-pair-elsewhere').textContent!
    expect(text).toContain('Middle value gap between them: 38%.')
    expect(text).toContain("Gridiron's 6 trades with other teams: 7%.")
    expect(text).toContain('Waivers has 1 trade with other teams, too few to compare.')
  })
})
