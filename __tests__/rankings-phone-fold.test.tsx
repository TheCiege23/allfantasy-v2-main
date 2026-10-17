import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { PhoneFold } from '@/components/core-app/rankings/PhoneFold'
import { RankTable, type RankColumn } from '@/components/core-app/rankings/RankTable'
import { boardControlsSummary } from '@/components/core-app/screens/Rankings'

afterEach(cleanup)

const columns: RankColumn[] = [
  { key: 'rank', label: '#', align: 'right', sortHref: '?sort=rank', sort: 'ascending' },
  { key: 'manager', label: 'Manager', sortHref: '?sort=manager', sort: 'none' },
  { key: 'score', label: 'Score', align: 'right', sortHref: '?sort=score', sort: 'none' },
]
const rows = [
  { id: 'a', cells: [{ text: '1' }, { text: '@alpha' }, { text: '78.4' }] },
  { id: 'b', cells: [{ text: '2' }, { text: '@beta' }, { text: '74.9' }] },
]

describe('PhoneFold', () => {
  it('holds its controls once, behind a labelled toggle', () => {
    const { container } = render(
      <PhoneFold id="fold-1" summary="Overall · Everyone · Sort: Rank ▲">
        <nav className="af-rk-tabs">tabs</nav>
      </PhoneFold>,
    )
    const toggle = container.querySelector('input.af-rk-fold-toggle') as HTMLInputElement
    expect(toggle.type).toBe('checkbox')
    expect(toggle.checked).toBe(false)
    expect(container.querySelector(`label[for="${toggle.id}"]`)?.textContent).toContain('Overall · Everyone · Sort: Rank ▲')
    expect(container.querySelectorAll('.af-rk-fold-body .af-rk-tabs')).toHaveLength(1)
  })
})

describe('RankTable phone sort', () => {
  it('renders its own sort chips by default', () => {
    const { container } = render(<RankTable caption="Board" columns={columns} rows={rows} emptyText="none" />)
    expect(container.querySelectorAll('.af-rk-phonesort')).toHaveLength(1)
  })

  it('leaves them out when the screen folds them elsewhere, so they appear once', () => {
    const { container } = render(<RankTable caption="Board" columns={columns} rows={rows} emptyText="none" phoneSort={false} />)
    expect(container.querySelector('.af-rk-phonesort')).toBeNull()
  })
})

describe('the folded summary says what is selected', () => {
  const g = {
    board: 'overall',
    label: 'Overall',
    tabs: [
      { key: 'overall', label: 'Overall', href: '?b=overall' },
      { key: 'titles', label: 'Titles', href: '?b=titles' },
    ],
    divisionFilter: { active: false, band: [3, 5] as [number, number], division: 4, href: '?d=1', offHref: '?' },
  }

  it('names the board, who is on it, and the sort', () => {
    expect(boardControlsSummary(g as never, columns)).toBe('Overall · Everyone · Sort: Rank ▲')
  })

  it('names the division range when the filter is on, and drops parts that do not apply', () => {
    expect(boardControlsSummary({ ...g, divisionFilter: { ...g.divisionFilter, active: true } } as never, columns)).toBe(
      'Overall · Divisions 3–5 · Sort: Rank ▲',
    )
    expect(boardControlsSummary({ ...g, divisionFilter: null } as never, columns.map((c) => ({ ...c, sort: 'none' as const })))).toBe(
      'Overall',
    )
  })
})
