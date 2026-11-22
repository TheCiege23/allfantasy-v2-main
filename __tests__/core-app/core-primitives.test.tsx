/**
 * Shared /core page pieces (components/core-app/primitives): the page header, the count-aware stat
 * strip, filter chips and the empty card. Each screen that moves onto them should read the same, so
 * the contracts here are what a migrated screen can rely on.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}))

import { EmptyState, FilterChips, PageHeader, StatStrip } from '@/components/core-app/primitives'

afterEach(cleanup)

describe('PageHeader', () => {
  it('draws eyebrow, title, sub and actions, and carries a screen class onto each slot', () => {
    const { container } = render(
      <PageHeader
        className="af-x-head"
        titleClassName="af-x-title"
        eyebrow="4 leagues"
        eyebrowTestId="x-eyebrow"
        title="My leagues"
        sub="4 live"
        actions={<a href="/import">Import</a>}
      />,
    )
    expect(container.querySelector('header')?.className).toBe('af-pg-head af-x-head')
    expect(screen.getByTestId('x-eyebrow').textContent).toBe('4 leagues')
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.textContent).toBe('My leagues')
    expect(h1.className).toBe('af-pg-title af-x-title')
    expect(container.querySelector('.af-pg-sub')?.textContent).toBe('4 live')
    expect(container.querySelector('.af-pg-actions a')?.getAttribute('href')).toBe('/import')
  })

  it('leaves out an empty eyebrow, sub and actions rather than drawing empty lines', () => {
    const { container } = render(<PageHeader title="Portfolio" eyebrow="" />)
    expect(container.querySelector('.af-pg-eyebrow')).toBeNull()
    expect(container.querySelector('.af-pg-sub')).toBeNull()
    expect(container.querySelector('.af-pg-actions')).toBeNull()
  })

  it('sets a titleAside on the title line, beside the heading and outside its accessible name', () => {
    const { container } = render(
      <PageHeader title="Season Outlook" titleRowClassName="af-x-row" titleAside={<span className="af-fresh">2 min ago</span>} />,
    )
    const row = container.querySelector('.af-pg-titlerow')
    expect(row?.className).toBe('af-pg-titlerow af-x-row')
    expect(row?.querySelector('h1')?.textContent).toBe('Season Outlook')
    expect(row?.querySelector(':scope > .af-fresh')?.textContent).toBe('2 min ago')
    expect(screen.getByRole('heading', { level: 1, name: 'Season Outlook' })).toBeTruthy()
    // No aside, no row: the heading sits straight in the headline, as before.
    cleanup()
    const plain = render(<PageHeader title="Standings" />)
    expect(plain.container.querySelector('.af-pg-titlerow')).toBeNull()
    expect(plain.container.querySelector('.af-pg-headline > h1')).not.toBeNull()
  })

  it('can be an h2 inside a page that already has its h1', () => {
    render(<PageHeader title="Panel" as="h2" />)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Panel')
  })
})

describe('StatStrip', () => {
  const items = [
    { key: 'a', label: 'Coin flips', value: 3, sub: 'Between 40% and 60%', tone: 'warn' as const },
    { key: 'b', label: 'Live now', value: 1 },
    { key: 'c', label: 'Decided', value: 2, tone: 'good' as const },
  ]

  it('stamps the tile count so the strip lays out by it, and each tile keeps its tone', () => {
    const { container } = render(<StatStrip items={items} testId="strip" ariaLabel="This week" />)
    const grid = container.querySelector('.af-pg-stats')!
    expect(grid.getAttribute('data-count')).toBe('3')
    const tiles = [...grid.querySelectorAll('.af-pg-stat')]
    expect(tiles.map((t) => t.getAttribute('data-tone'))).toEqual(['warn', null, 'good'])
    expect(tiles.map((t) => t.querySelector('.af-pg-stat-value')?.textContent)).toEqual(['3', '1', '2'])
    expect(tiles[1].querySelector('.af-pg-stat-sub')).toBeNull()
    expect(screen.getByTestId('strip').getAttribute('aria-label')).toBe('This week')
  })

  it('draws nothing for no numbers', () => {
    const { container } = render(<StatStrip items={[]} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('FilterChips', () => {
  it('marks the selected chip pressed and reports a new choice', () => {
    const onChange = vi.fn()
    render(
      <FilterChips
        ariaLabel="Filter tools"
        value="all"
        onChange={onChange}
        scrollOnPhone
        options={[
          { id: 'all', label: 'All', testId: 'f-all' },
          { id: 'mine', label: 'Mine', count: 0, testId: 'f-mine' },
        ]}
      />,
    )
    expect(screen.getByRole('group', { name: 'Filter tools' }).getAttribute('data-scroll')).toBe('phone')
    expect(screen.getByTestId('f-all').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('f-mine').getAttribute('aria-pressed')).toBe('false')
    // A count of 0 is a fact worth showing; an absent count is not drawn.
    expect(screen.getByTestId('f-mine').querySelector('.af-pg-chip-n')?.textContent).toBe('0')
    expect(screen.getByTestId('f-all').querySelector('.af-pg-chip-n')).toBeNull()
    fireEvent.click(screen.getByTestId('f-mine'))
    expect(onChange).toHaveBeenCalledWith('mine')
  })
})

describe('EmptyState', () => {
  it('is a titled card with the reason, links and actions', () => {
    render(
      <EmptyState
        testId="empty"
        mark="+"
        title="No claimed teams to show yet"
        body="import a league to see it here."
        links={[{ href: '/core/my-team', label: 'Check your lineup' }]}
        actions={<button type="button">Import a league</button>}
      />,
    )
    const card = screen.getByTestId('empty')
    expect(card.className).toBe('af-empty-card')
    expect(card.querySelector('.af-empty-card-title')?.textContent).toBe('No claimed teams to show yet')
    expect(card.querySelector('.af-empty-card-body')?.textContent).toBe('import a league to see it here.')
    expect(card.querySelector('.af-empty-card-links a')?.getAttribute('href')).toBe('/core/my-team')
    expect(card.querySelector('.af-empty-card-actions button')?.textContent).toBe('Import a league')
    expect(card.querySelector('.af-empty-card-mark')?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('af-primitives.css', () => {
  const css = readFileSync(join(process.cwd(), 'components/core-app/primitives/af-primitives.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const core = readFileSync(join(process.cwd(), 'components/core-app/af-core.css'), 'utf8')

  it('sizes every page title from the one token, 30px and 26px at phone width', () => {
    expect(css).toMatch(/\.af-core \.af-pg-title \{[^}]*font: 800 var\(--af-title-size, 30px\)/)
    expect(core).toMatch(/--af-title-size: 30px;/)
    expect(core).toMatch(/@media \(max-width: 760px\) \{\s*\.af-core \{ --af-title-size: 26px; \}/)
  })

  it('lays the stat strip out by count: one row from 760px, full rows only between 600 and 759px', () => {
    expect(css).toMatch(/@container af-pg-stats \(min-width: 760px\) \{[^@]*grid-auto-flow: column/)
    expect(css).toMatch(/\.af-pg-stats\[data-count='5'\] > \.af-pg-stat:nth-child\(n \+ 4\) \{ grid-column: span 3; \}/)
    expect(css).toMatch(/\.af-pg-stats > \.af-pg-stat:last-child:nth-child\(odd\) \{ grid-column: 1 \/ -1; \}/)
  })

  it('scopes every rule to the /core token layer, and only the header layout sits in :where()', () => {
    // A selector starts after the previous rule's `}` or after an @media / @container `{`.
    const selectors = [...css.matchAll(/(^|[{}])\s*([^{}@]+)\{/g)].map((m) => m[2].trim())
    expect(selectors.length).toBeGreaterThan(30)
    const loose = selectors.flatMap((s) => s.split(',').map((x) => x.trim())).filter((s) => !s.startsWith('.af-core ') && s !== ':where(.af-pg-head)')
    expect(loose).toEqual([])
  })

  it('draws cards on the card radius token, never a one-off radius', () => {
    const radii = [...css.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1].trim())
    expect(radii.every((r) => r === '999px' || r.startsWith('var(--af-radius-'))).toBe(true)
  })
})
