import React from 'react'
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { OddsHistoryChart } from '@/components/core-app/outlook/OddsHistoryChart'

const points = [
  { week: 2, playoffPct: 38, titlePct: 4.5 },
  { week: 3, playoffPct: 47, titlePct: 7 },
  { week: 4, playoffPct: 61.6, titlePct: 12.4 },
]

describe('OddsHistoryChart', () => {
  it('draws both series on one axis, with a legend, direct end labels and the numbers table', () => {
    render(<OddsHistoryChart points={points} />)
    const chart = screen.getByTestId('outlook-odds-history')

    // Both series: a line each, a marker per week each, in the fixed order playoffs then title.
    const playoff = screen.getByTestId('outlook-odds-history-series-playoff')
    const title = screen.getByTestId('outlook-odds-history-series-title')
    expect(playoff.querySelector('path')!.getAttribute('stroke')).toBe('var(--chart-1)')
    expect(title.querySelector('path')!.getAttribute('stroke')).toBe('var(--chart-2)')
    expect(playoff.querySelectorAll('circle')).toHaveLength(3)
    expect(title.querySelectorAll('rect')).toHaveLength(3)
    const order = Array.from(chart.querySelectorAll('[data-testid^="outlook-odds-history-series-"]')).map((g) => g.getAttribute('data-testid'))
    expect(order).toEqual(['outlook-odds-history-series-playoff', 'outlook-odds-history-series-title'])

    // One 0–100% axis.
    const ticks = Array.from(chart.querySelectorAll('.af-olk-hist-tick')).map((t) => t.textContent)
    expect(ticks.slice(0, 5)).toEqual(['0%', '25%', '50%', '75%', '100%'])

    // Legend and direct labels name both series; the label text is the latest week's value.
    expect(screen.getByTestId('outlook-odds-history-legend-playoff').textContent).toBe('Playoffs')
    expect(screen.getByTestId('outlook-odds-history-legend-title').textContent).toBe('Title')
    expect(screen.getByTestId('outlook-odds-history-label-playoff').textContent).toBe('62% Playoffs')
    expect(screen.getByTestId('outlook-odds-history-label-title').textContent).toBe('12% Title')

    // "Show the numbers": every week, both series.
    expect(chart.querySelector('details summary')!.textContent).toBe('Show the numbers')
    const rows = Array.from(chart.querySelectorAll('tbody tr')).map((r) => r.textContent)
    expect(rows).toEqual(['Week 238%5%', 'Week 347%7%', 'Week 462%12%'])
  })

  it('shows the same readout on keyboard focus as on hover, and moves with the arrow keys', () => {
    render(<OddsHistoryChart points={points} />)
    const plot = screen.getByRole('group', { name: /week 2 to week 4/ })
    expect(screen.queryByTestId('outlook-odds-history-tip')).toBeNull()
    fireEvent.focus(plot)
    expect(screen.getByTestId('outlook-odds-history-tip').textContent).toBe('Week 462% Playoffs12% Title')
    fireEvent.keyDown(plot, { key: 'ArrowLeft' })
    expect(screen.getByTestId('outlook-odds-history-tip').textContent).toBe('Week 347% Playoffs7% Title')
    fireEvent.keyDown(plot, { key: 'Home' })
    expect(screen.getByTestId('outlook-odds-history-tip').textContent).toContain('Week 2')
    fireEvent.blur(plot)
    expect(screen.queryByTestId('outlook-odds-history-tip')).toBeNull()
  })

  it('renders nothing at all with no data or a single week', () => {
    for (const p of [null, undefined, [], [points[0]]]) {
      const { container, unmount } = render(<OddsHistoryChart points={p} />)
      expect(container.innerHTML).toBe('')
      unmount()
    }
  })
})
