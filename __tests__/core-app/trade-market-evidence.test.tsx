import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { TRADE_CARD_EVIDENCE_MAX, TradeMarketEvidence } from '@/components/core-app/screens/TradeMarketEvidence'
import { gradeTrade, type TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'

/* The trade card's "from real trades" line (owner's call, 2026-11-22): the measured reasons, verbatim, or nothing. */

afterEach(cleanup)

const POSTURE = 'teams at .600 or better paid +8% for players 27 or older over middle-of-the-table teams across 210 completed trades'
const base = (moves: Array<{ side: 'give' | 'get'; name: string; base: number; leagueValue: number; reasons: string[] }>): TradeGradeView =>
  gradeTrade({ giveValue: 5000, getValue: 5200, giveMarket: 5000, getMarket: 5000, unpriced: 0, giveCount: 1, getCount: 1, basis: 'Dynasty', scoringApplied: false, needApplied: false, needGap: null, lines: [], moves })

describe('TradeMarketEvidence', () => {
  it('lists the measured reasons under a heading, and leaves out scoring', () => {
    render(<TradeMarketEvidence grade={base([{ side: 'get', name: 'Vet Back', base: 5000, leagueValue: 5200, reasons: ['Half-PPR scoring', POSTURE] }])} />)
    expect(screen.getByText('From real trades on AllFantasy')).toBeTruthy()
    expect(screen.getByText(`Vet Back: ${POSTURE}`)).toBeTruthy()
    expect(screen.queryByText(/Half-PPR/)).toBeNull()
  })

  it('renders nothing for an ungraded deal or a grade with no measured reason', () => {
    const { container } = render(<TradeMarketEvidence grade={base([{ side: 'get', name: 'X', base: 1, leagueValue: 2, reasons: ['Half-PPR scoring'] }])} />)
    expect(container.innerHTML).toBe('')
    const none = render(<TradeMarketEvidence grade={{ graded: false, reason: 'unpriced' } as TradeGradeView} />)
    expect(none.container.innerHTML).toBe('')
  })

  it('shows at most a few lines on a card, and passes each through the translator', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ side: 'get' as const, name: `P${i}`, base: 1, leagueValue: 2, reasons: [`x across ${i + 5} completed trades`] }))
    render(<TradeMarketEvidence grade={base(many)} copy={(s) => `«${s}»`} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(TRADE_CARD_EVIDENCE_MAX)
    expect(screen.getByText('«From real trades on AllFantasy»')).toBeTruthy()
  })
})
