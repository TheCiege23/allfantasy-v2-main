// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TradeEvidencePanel } from '@/components/core-app/screens/TradeEvidencePanel'
import { gradeTrade } from '@/lib/decision-os/trade/tradeGrade'

afterEach(cleanup)
const grade = gradeTrade({
  giveValue: 5000, getValue: 6000, giveMarket: 5000, getMarket: 6000,
  giveCount: 1, getCount: 2, unpriced: 0, basis: 'Market', scoringApplied: false,
  needApplied: false, needGap: null, moves: [],
  lines: [
    { name: 'Star', side: 'give', assetKind: 'player', leagueValue: 5000, marketValue: 5000, valueSource: 'fantasycalc', valueAsOf: '2026-10-02' },
    { name: 'Depth A', side: 'get', assetKind: 'player', leagueValue: 3000, marketValue: 3000, valueSource: 'fantasycalc', valueAsOf: '2026-10-02' },
    { name: 'Depth B', side: 'get', assetKind: 'player', leagueValue: 3000, marketValue: 3000, valueSource: 'fantasycalc', valueAsOf: '2026-10-02' },
  ],
})
describe('trade evidence panel', () => {
  it('shows evidence, slot consequences and a selectable sensitivity scenario', () => {
    if (!grade.graded) throw new Error('Fixture not graded')
    render(<TradeEvidencePanel grade={grade} evaluatedAt="2026-10-03" generic gaps={['Lineup unavailable.']} />)
    expect(screen.getByText('Mixed evidence')).toBeTruthy()
    expect(screen.getByText(/Team A sends 1 player and receives 2/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Value stress scenario'), { target: { value: '20' } })
    expect(screen.getByText(/outgoing prices rose 20%/)).toBeTruthy()
    expect(screen.getByText(/not a forecast, confidence interval/)).toBeTruthy()
  })
})

