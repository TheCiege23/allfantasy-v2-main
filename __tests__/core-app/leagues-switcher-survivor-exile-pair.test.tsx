import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

/**
 * The /leagues page and the "All leagues" switcher draw each Exile Island under its own Survivor
 * league, joined by ↕ — the same pairing as the rail and the home card (reported 2026-10-30: two
 * NBA Survivor leagues, two islands, and no way to tell which island went with which).
 */

const nav = vi.hoisted(() => ({ router: { push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {} } }))
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, prefetch: _p, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: unknown }) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}))

import { MyLeaguesV4 } from '@/components/core-app/screens/MyLeaguesV4'
import { ScopeSwitcher } from '@/components/core-app/ScopeSwitcher'
import type { MyLeaguesLeague } from '@/lib/core-app/myLeagues'

afterEach(cleanup)

type Row = { id: string; name: string; exileOf?: string; tier: MyLeaguesLeague['tier'] }
const ROWS: Row[] = [
  { id: 'exile-a', name: 'Exile Island: NBA Survivor', exileOf: 'survivor-a', tier: 'quiet' },
  { id: 'exile-b', name: "Exile Island: TheCiege's Survivor", exileOf: 'survivor-b', tier: 'quiet' },
  { id: 'redraft', name: 'The Ciege NBA Redraft', tier: 'playing' },
  { id: 'survivor-a', name: 'NBA Survivor', tier: 'playing' },
  { id: 'survivor-b', name: "TheCiege's Survivor", tier: 'needs' },
]
const strip = (rows: Row[]) => rows.map(({ exileOf: _e, ...r }) => r)

const COUNTS = { live: 5, history: 0, all: 5, needs: 1, playing: 2, quiet: 2, commissioner: 0, drafting: 0, dynasty: 0 }
function renderPage(rows: Row[]) {
  const leagues = rows.map((r) => ({
    ...r, platform: 'manual', sport: 'NBA', isDynasty: false, isCommissioner: false, reason: null, href: `/league/${r.id}`,
  })) as unknown as MyLeaguesLeague[]
  return render(
    <MyLeaguesV4 leagues={leagues} history={[]} counts={COUNTS} platforms={['manual']} coverage={[]} notice={null} importHref="/import" />,
  )
}

/** A tier's cards top to bottom by full name, with the connector as "↕". */
function tierOrder(tier: string): string[] {
  const grid = document.querySelector(`.af-ml-grid[data-tier="${tier}"]`)
  if (!grid) return []
  return Array.from(grid.querySelectorAll('.af-ml-exile-link, .af-ml-card-name')).map((el) =>
    el.classList.contains('af-ml-exile-link') ? '↕' : el.getAttribute('title')!,
  )
}

describe('Survivor and Exile Island on /leagues', () => {
  it('draws each island under its Survivor league, in that league\'s tier, joined by ↕', () => {
    renderPage(ROWS)
    expect(tierOrder('needs')).toEqual(["TheCiege's Survivor", '↕', "Exile Island: TheCiege's Survivor"])
    expect(tierOrder('playing')).toEqual(['The Ciege NBA Redraft', 'NBA Survivor', '↕', 'Exile Island: NBA Survivor'])
    expect(tierOrder('quiet')).toEqual([])
    expect(document.querySelectorAll('[data-testid="leagues-exile-pair"]')).toHaveLength(2)
  })

  it('names a paired island "Exile Island" and keeps its full name in the title', () => {
    renderPage(ROWS)
    const island = document.querySelector('.af-ml-card[data-exile="true"] .af-ml-card-name')!
    expect(island.textContent).toBe('Exile Island')
    expect(island.getAttribute('title')).toMatch(/^Exile Island: /)
  })

  it('CONTROL: without the link each island is an ordinary card in its own tier', () => {
    renderPage(strip(ROWS))
    expect(tierOrder('quiet')).toEqual(['Exile Island: NBA Survivor', "Exile Island: TheCiege's Survivor"])
    expect(document.querySelector('[data-exile="true"]')).toBeNull()
  })
})

function renderSwitcher(rows: Row[]) {
  render(
    <ScopeSwitcher
      leagues={rows.map((r) => ({ id: r.id, name: r.name, exileOf: r.exileOf, platform: 'manual', sport: 'NBA' }))}
      scopeValue={null}
      label="All leagues"
      selectedLeagueId={null}
      favoriteIds={[]}
      leagueScreen={false}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Viewing/ }))
}

/** The switcher's list top to bottom by full name, with the connector as "↕". */
function switcherOrder(): string[] {
  return Array.from(document.querySelectorAll('.af-scope-list > li')).map((li) =>
    li.classList.contains('af-scope-exile-link')
      ? '↕'
      : li.querySelector('.af-scope-league')!.getAttribute('aria-label') ?? li.querySelector('.af-scope-league-name')!.textContent!,
  )
}

describe('Survivor and Exile Island in the "All leagues" switcher', () => {
  it('draws each island under its Survivor league, joined by ↕, named "Exile Island"', () => {
    renderSwitcher(ROWS)
    expect(switcherOrder()).toEqual([
      'The Ciege NBA Redraft', 'NBA Survivor', '↕', 'Exile Island: NBA Survivor', "TheCiege's Survivor", '↕', "Exile Island: TheCiege's Survivor",
    ])
    const islandNames = Array.from(document.querySelectorAll('.af-scope-row[data-exile="true"] .af-scope-league-name')).map((n) => n.textContent)
    expect(islandNames).toEqual(['Exile Island', 'Exile Island'])
  })

  it('CONTROL: without the link the islands stay where they were', () => {
    renderSwitcher(strip(ROWS))
    expect(switcherOrder()).toEqual(ROWS.map((r) => r.name))
    expect(document.querySelector('.af-scope-exile-link')).toBeNull()
  })
})
