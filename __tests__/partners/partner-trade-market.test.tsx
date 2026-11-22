import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { TradeMarketBars } from '@/components/partners/TradeMarketBars'
import { DEMO_TRADE_MARKET, tradeMarketSentence, tradeMarketView, type TradeMarketRow } from '@/lib/partner-portal/demoTenant'

/** The partner demo's "what managers actually pay in trades" panel (sample data; owner's call, 2026-11-22). */

const ROWS: TradeMarketRow[] = [
  { group: 'Draft picks', label: 'First', premiumPct: 15, trades: 1200 },
  { group: 'Roster need', label: 'Deep', premiumPct: -4, trades: 150 },
  { group: 'Draft picks', label: 'Thin', premiumPct: null, trades: 12, needed: 20 },
  { group: 'Roster need', label: 'Flat', premiumPct: 0, trades: 40 },
]

describe('tradeMarketView', () => {
  it('groups in first-seen order and shares one scale: the largest move rounded up to 5, never under 10', () => {
    const v = tradeMarketView(ROWS)
    expect(v.groups.map((g) => [g.group, g.rows.map((r) => r.label)])).toEqual([['Draft picks', ['First', 'Thin']], ['Roster need', ['Deep', 'Flat']]])
    expect(v.scalePct).toBe(15)
    expect(tradeMarketView([{ group: 'Draft picks', label: 'a', premiumPct: 28, trades: 30 }]).scalePct).toBe(30)
    expect(tradeMarketView([{ group: 'Draft picks', label: 'a', premiumPct: 3, trades: 30 }]).scalePct).toBe(10)
  })

  it('counts only published rows, and only the trades behind them', () => {
    const v = tradeMarketView(ROWS)
    expect(v.published).toBe(3)
    expect(v.tradesBehindPublished).toBe(1390)
  })
})

describe('tradeMarketSentence', () => {
  it('says more, less, in line, or not enough yet — never a number for an unpublished row', () => {
    expect(tradeMarketSentence(ROWS[0]!)).toBe('First: paid 15% more than the standard chart across 1,200 completed trades')
    expect(tradeMarketSentence(ROWS[1]!)).toBe('Deep: paid 4% less than the standard chart across 150 completed trades')
    expect(tradeMarketSentence(ROWS[3]!)).toBe('Flat: in line with the standard chart across 40 completed trades')
    expect(tradeMarketSentence(ROWS[2]!)).toBe('Thin: not enough completed trades yet (12 of 20), so the standard chart is used')
  })
})

describe('TradeMarketBars', () => {
  it('prints the signed number beside each published row, and the trades still needed beside an unpublished one', () => {
    render(<TradeMarketBars rows={ROWS} />)
    // Beside the row (the same figure also appears in the table view and, for the largest, on the axis).
    const beside = (label: string) => screen.getByText(label).parentElement!.textContent
    expect(beside('First')).toBe('First+15% · 1,200 trades')
    expect(beside('Deep')).toBe('Deep−4% · 150 trades')
    expect(screen.getByText(/12 of 20 trades needed/)).toBeTruthy()
    // Every bar has an accessible sentence; the unpublished one carries no percentage.
    expect(screen.getByRole('img', { name: /^Thin: not enough completed trades yet/ })).toBeTruthy()
    expect(screen.getAllByRole('img')).toHaveLength(4)
  })

  it('bars grow right for "more" and left for "less", scaled to the shared scale', () => {
    render(<TradeMarketBars rows={ROWS} />)
    const more = screen.getByRole('img', { name: /^First:/ }).querySelector('span[style*="width"]') as HTMLElement
    const less = screen.getByRole('img', { name: /^Deep:/ }).querySelector('span[style*="width"]') as HTMLElement
    expect(more.style.left).toBe('50%')
    expect(more.style.width).toBe('50%')
    expect(less.style.right).toBe('50%')
    expect(parseFloat(less.style.width)).toBeCloseTo((4 / 15) * 50, 3)
    expect(screen.getByRole('img', { name: /^Thin:/ }).querySelector('span[style*="width"]')).toBeNull()
  })

  it('the readout shows the summary, then the focused row’s sentence', () => {
    render(<TradeMarketBars rows={ROWS} />)
    const status = screen.getByRole('status')
    expect(status.textContent).toMatch(/^3 of 4 situations have enough completed trades to publish a number \(1,390 trades behind them\)/)
    fireEvent.focus(screen.getByRole('img', { name: /^Deep:/ }))
    expect(status.textContent).toBe('Deep: paid 4% less than the standard chart across 150 completed trades')
  })

  it('has a table view with every row', () => {
    render(<TradeMarketBars rows={ROWS} />)
    const rows = within(screen.getByRole('table')).getAllByRole('row')
    expect(rows).toHaveLength(5)
    expect(rows[3]!.textContent).toContain('Not enough trades yet')
  })

  it('the sample data keeps one unpublished row, so the demo shows what "not yet" looks like', () => {
    expect(DEMO_TRADE_MARKET.some((r) => r.premiumPct == null)).toBe(true)
    expect(DEMO_TRADE_MARKET.every((r) => r.trades > 0)).toBe(true)
  })
})
