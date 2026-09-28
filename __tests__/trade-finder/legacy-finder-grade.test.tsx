/**
 * The af-legacy finder tab (TradeFinderV2) shows THE grade (2026-09-27), and makes no fairness claim
 * of its own for a countered deal.
 *
 * ⚠ RENDERED: the two pieces the trade card draws — the grade line, and the note that replaces the
 * finder's own "Fair Trade / Leans Your Way" label once a counter changes the deal.
 */
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CounterAppliedNote, LeagueGradeLine } from '@/components/TradeFinderV2'

describe('LeagueGradeLine', () => {
  it('draws your letter, the partner’s, the label and the league values', () => {
    render(<LeagueGradeLine partnerName="Nicolodeon" grade={{ graded: true, letter: 'D', partnerLetter: 'B', label: 'Slightly favors opponent', giveValue: 5900, getValue: 6000 }} />)
    expect(screen.getByTestId('finder-grade').textContent).toBe('D for you · Nicolodeon BSlightly favors opponentyou get 6,000 for 5,900 in league value')
  })

  it('a withheld grade says why with no letter; no grade draws nothing', () => {
    const { container, rerender } = render(<LeagueGradeLine partnerName="X" grade={{ graded: false, reason: '1 asset has no value on this league’s chart' }} />)
    expect(screen.getByTestId('finder-grade-withheld').textContent).toBe('Not graded: 1 asset has no value on this league’s chart')
    rerender(<LeagueGradeLine partnerName="X" grade={null} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('CounterAppliedNote', () => {
  it('🛑 makes no fairness claim for a countered deal, and keeps Reset', () => {
    const onReset = vi.fn()
    render(<CounterAppliedNote onReset={onReset} />)
    const note = screen.getByTestId('finder-counter-applied')
    expect(note.textContent).toContain('The league grade was for the original deal')
    expect(note.textContent).not.toMatch(/Fair Trade|Leans|Fleece|Slight Edge|Overpay/)
    fireEvent.click(screen.getByText('Reset'))
    expect(onReset).toHaveBeenCalledTimes(1)
  })
})
