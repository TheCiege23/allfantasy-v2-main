import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

/**
 * The "All leagues" switcher shows your record and place on each row — the rail row's "6-3 · 2nd"
 * — so picking a league from the dropdown says how you stand in it (asked for 2026-11-05).
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

import { ScopeSwitcher, type ScopeSwitcherLeague } from '@/components/core-app/ScopeSwitcher'

afterEach(cleanup)

function open(leagues: ScopeSwitcherLeague[]) {
  render(
    <ScopeSwitcher leagues={leagues} scopeValue={null} label="All leagues" selectedLeagueId={null} favoriteIds={[]} leagueScreen={false} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Viewing/ }))
}

function metaOf(name: string): string {
  const row = Array.from(document.querySelectorAll('.af-scope-row')).find(
    (li) => li.querySelector('.af-scope-league-name')?.textContent?.includes(name),
  )
  return row?.querySelector('.af-scope-league-meta')?.textContent ?? ''
}

describe('league switcher rows carry your record', () => {
  it('shows W-L and your place after the sport and platform', () => {
    open([
      { id: 'a', name: '33 1/3% Active', platform: 'sleeper', sport: 'NFL', record: { wins: 6, losses: 3, ties: 0, rank: 2, teams: 12 } },
    ])
    expect(metaOf('33 1/3% Active')).toBe('🏈NFLSleeper6-3 · 2nd')
    expect(screen.getByTestId('scope-league-record').textContent).toBe('6-3 · 2nd')
  })

  it('adds ties only when there are some, and leaves the place off when it cannot be stated', () => {
    open([
      { id: 'b', name: 'Tie League', platform: 'sleeper', sport: 'NFL', record: { wins: 5, losses: 3, ties: 1, rank: null, teams: 10 } },
    ])
    expect(screen.getByTestId('scope-league-record').textContent).toBe('5-3-1')
  })

  it('draws no record line for a league without one (a Guillotine race, or nothing played)', () => {
    open([
      { id: 'c', name: '2026 BB Guilly League!', platform: 'sleeper', sport: 'NFL', record: null },
      { id: 'd', name: 'No Record', platform: 'sleeper', sport: 'NFL' },
    ])
    expect(screen.queryByTestId('scope-league-record')).toBeNull()
    expect(metaOf('2026 BB Guilly League!')).toBe('🏈NFLSleeper')
  })
})

describe('a field race says where you stand instead of a W-L', () => {
  it('shows your place among the survivors', () => {
    open([{ id: 'g', name: 'Guillotine League 26', platform: 'sleeper', sport: 'NFL', record: null, field: { state: 'alive', rank: 3, outOf: 10 } }])
    expect(screen.getByTestId('scope-league-field').textContent).toBe('3rd of 10 alive')
    expect(screen.queryByTestId('scope-league-record')).toBeNull()
  })

  it('shows the week you were chopped', () => {
    open([{ id: 'g', name: 'Guillotine League 26', platform: 'sleeper', sport: 'NFL', record: null, field: { state: 'chopped', week: 5 } }])
    expect(screen.getByTestId('scope-league-field').textContent).toBe('Chopped wk 5')
  })

  it('CONTROL: a W-L record wins over a field line when both are given', () => {
    open([{ id: 'r', name: 'Redraft', platform: 'sleeper', sport: 'NFL', record: { wins: 6, losses: 3, ties: 0, rank: 2, teams: 12 }, field: { state: 'alive', rank: 1, outOf: 12 } }])
    expect(screen.getByTestId('scope-league-record').textContent).toBe('6-3 · 2nd')
    expect(screen.queryByTestId('scope-league-field')).toBeNull()
  })
})
