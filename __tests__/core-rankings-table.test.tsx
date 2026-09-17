import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, within } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/link', () => ({
  default: ({ href, children, scroll: _scroll, ...rest }: { href: string; children: React.ReactNode; scroll?: boolean }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { RankTable, VIRTUALIZE_AT, type RankColumn, type RankRow } from '@/components/core-app/rankings/RankTable'
import { TrendLine } from '@/components/core-app/rankings/TrendLine'

/*
 * The accessible-table contract for /core/rankings.
 *
 * ⚠ THESE ASSERT WHAT A SCREEN READER RELIES ON, NOT HOW IT LOOKS: a real
 * <table> with a caption, column headers, a row header per row, aria-sort on the
 * sorted column, and — when windowed — the TRUE row count, not the DOM's.
 */

const columns: RankColumn[] = [
  { key: 'rank', label: '#', srLabel: 'Rank', align: 'right', sortHref: '/core/rankings', sort: 'ascending' },
  { key: 'manager', label: 'Manager', sortHref: '/core/rankings?sort=manager', sort: 'none' },
  { key: 'score', label: 'Score', align: 'right' },
]

function rows(count: number): RankRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `u${i}`,
    highlight: i === 1,
    cells: [{ text: String(i + 1) }, { text: `@manager${i}`, sub: 'Lvl 3' }, { text: (90 - i).toFixed(1) }],
  }))
}

describe('RankTable', () => {
  it('renders a semantic table with caption, column headers, row headers and aria-sort', () => {
    const { container } = render(<RankTable caption="Overall — All leagues" columns={columns} rows={rows(3)} emptyText="none" />)
    const table = container.querySelector('table')!
    expect(table).not.toBeNull()
    expect(table.getAttribute('aria-rowcount')).toBe('4')
    expect(within(table).getByText('Overall — All leagues', { exact: false }).tagName).toBe('CAPTION')

    const heads = table.querySelectorAll('thead th')
    expect([...heads].map((h) => h.getAttribute('scope'))).toEqual(['col', 'col', 'col'])
    expect(heads[0].getAttribute('aria-sort')).toBe('ascending')
    expect(heads[1].getAttribute('aria-sort')).toBe('none')
    // A column that cannot be sorted carries no aria-sort at all.
    expect(heads[2].hasAttribute('aria-sort')).toBe(false)
    // Sorting is a link, so it works from the keyboard and without JavaScript.
    expect(heads[1].querySelector('a')?.getAttribute('href')).toBe('/core/rankings?sort=manager')

    const rowHeaders = table.querySelectorAll('tbody th[scope="row"]')
    expect([...rowHeaders].map((h) => h.textContent)).toEqual(['@manager0Lvl 3', '@manager1Lvl 3', '@manager2Lvl 3'])
    expect(table.querySelectorAll('tbody tr')[1].className).toContain('af-rk-row-you')
    // The scroll region is keyboard-reachable and named.
    expect(container.querySelector('[role="region"]')?.getAttribute('tabindex')).toBe('0')
  })

  it('says why it is empty instead of drawing an empty table', () => {
    const { container } = render(<RankTable caption="x" columns={columns} rows={[]} emptyText="Nobody qualifies yet." />)
    expect(container.querySelector('table')).toBeNull()
    expect(container.textContent).toBe('Nobody qualifies yet.')
  })

  it('keeps every row in the server HTML below the windowing threshold', () => {
    const html = renderToStaticMarkup(<RankTable caption="x" columns={columns} rows={rows(VIRTUALIZE_AT)} emptyText="none" />)
    expect(html.match(/<tr[^>]*aria-rowindex=/g)?.length).toBe(VIRTUALIZE_AT + 1)
  })

  it('windows a long list but still reports the true size', () => {
    const total = 600
    const html = renderToStaticMarkup(<RankTable caption="x" columns={columns} rows={rows(total)} emptyText="none" />)
    const rendered = html.match(/<tr[^>]*aria-rowindex=/g)?.length ?? 0
    expect(rendered).toBeGreaterThan(1)
    expect(rendered).toBeLessThan(total / 4)
    expect(html).toContain(`aria-rowcount="${total + 1}"`)
    // The first data row is row 2 (the header is row 1), whatever slice is rendered.
    expect(html).toContain('aria-rowindex="2"')
    // The skipped height below the window is a spacer row hidden from assistive tech.
    expect(html).toMatch(/<tr aria-hidden="true" class="af-rk-vspacer">/)
  })
})

describe('TrendLine', () => {
  it('breaks the line at a gap and lists the gap in the table', () => {
    const html = renderToStaticMarkup(
      <TrendLine
        title="7-day rank"
        invert
        points={[
          { label: '2026-09-10', value: 3 },
          { label: '2026-09-11', value: null },
          { label: '2026-09-12', value: 2 },
        ]}
        format={(n) => String(n)}
        empty="none"
      />,
    )
    // Two separate path segments, not one joined across the missing day.
    expect(html.match(/<path /g)?.length).toBe(2)
    expect(html).toContain('Not recorded')
    expect(html).toContain('#3 → #2')
    // Rank improving is shown as good.
    expect(html).toContain('af-rk-trend-now af-rk-tone-good')
    // The chart itself is hidden from assistive tech; the table carries the data.
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/)
  })

  it('shows its empty sentence rather than an empty chart', () => {
    const html = renderToStaticMarkup(<TrendLine title="Weekly rank" points={[{ label: 'a', value: null }]} empty="Weekly snapshots have not started yet." />)
    expect(html).not.toContain('<svg')
    expect(html).toContain('Weekly snapshots have not started yet.')
  })
})
