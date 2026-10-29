import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MyLeaguesV4 } from '@/components/core-app/screens/MyLeaguesV4'
import { leagueSportCounts, leagueSportKey, leagueSportLabel } from '@/lib/core-app/leagueSports'
import type { MyLeaguesLeague } from '@/lib/core-app/myLeagues'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}))

function league(id: string, sport: string | null, over: Partial<MyLeaguesLeague> = {}): MyLeaguesLeague {
  return {
    id,
    name: `League ${id}`,
    platform: 'sleeper',
    sport,
    tier: 'quiet',
    isDynasty: false,
    isCommissioner: false,
    reason: null,
    href: `/core?league=${id}`,
    ...over,
  } as MyLeaguesLeague
}

const COUNTS = { live: 0, history: 0, all: 0, needs: 0, playing: 0, quiet: 0, commissioner: 0, drafting: 0, dynasty: 0 }

function renderList(leagues: MyLeaguesLeague[]) {
  return render(
    <MyLeaguesV4
      leagues={leagues}
      history={[]}
      counts={{ ...COUNTS, live: leagues.length, all: leagues.length, quiet: leagues.length }}
      platforms={['sleeper']}
      coverage={[]}
      notice={null}
      importHref="/import"
    />,
  )
}

const cardNames = () => screen.queryAllByRole('heading', { level: 3 }).map((h) => h.textContent)

describe('leagueSports helpers', () => {
  it('keeps a league with no sport out of NFL', () => {
    expect(leagueSportKey(null)).toBeNull()
    expect(leagueSportKey('  ')).toBeNull()
    expect(leagueSportKey('nba')).toBe('NBA')
    expect(leagueSportKey('NCAAFB')).toBe('NCAAF')
    expect(leagueSportLabel(null)).toBe('Other')
    expect(leagueSportLabel('NCAAB', { short: true })).toBe('CBB')
  })

  it('counts sports in product order with Other last, whatever order the leagues arrive in', () => {
    const counts = leagueSportCounts([
      { sport: null },
      { sport: 'NHL' },
      { sport: 'NFL' },
      { sport: 'NBA' },
      { sport: 'NFL' },
    ])
    expect(counts).toEqual([
      { key: 'NFL', count: 2 },
      { key: 'NBA', count: 1 },
      { key: 'NHL', count: 1 },
      { key: null, count: 1 },
    ])
  })
})

describe('My Leagues sport tabs', () => {
  const mixed = [league('a', 'NFL'), league('b', 'NBA'), league('c', 'NHL'), league('d', 'NFL'), league('e', null)]

  it('shows one tab per sport the account plays, with counts', () => {
    renderList(mixed)
    const tabs = within(screen.getByRole('group', { name: 'Filter by sport' })).getAllByRole('button')
    expect(tabs.map((t) => t.textContent)).toEqual(['All sports 5', 'NFL 2', 'NBA 1', 'NHL 1', 'Other 1'])
  })

  it('filters the list to one sport, and a second tap returns to all', () => {
    renderList(mixed)
    const group = screen.getByRole('group', { name: 'Filter by sport' })
    fireEvent.click(within(group).getByRole('button', { name: /^NBA/ }))
    expect(cardNames()).toEqual(['League b'])
    fireEvent.click(within(group).getByRole('button', { name: /^NBA/ }))
    expect(cardNames()).toHaveLength(5)
  })

  it('keeps the server order inside a sport -- the list is ranked by urgency, not re-sorted', () => {
    renderList([league('z', 'NFL'), league('a', 'NBA'), league('m', 'NFL'), league('b', 'NFL')])
    fireEvent.click(within(screen.getByRole('group', { name: 'Filter by sport' })).getByRole('button', { name: /^NFL/ }))
    expect(cardNames()).toEqual(['League z', 'League m', 'League b'])
  })

  it('labels each card with its sport', () => {
    renderList(mixed)
    const meta = screen.getAllByText((_, el) => el?.classList.contains('af-ml-sport') ?? false)
    expect(meta.map((m) => m.textContent)).toEqual(['NFL', 'NBA', 'NHL', 'NFL', 'Other'])
  })

  it('shows no tabs when the account plays a single sport', () => {
    renderList([league('a', 'NFL'), league('b', 'NFL')])
    expect(screen.queryByRole('group', { name: 'Filter by sport' })).toBeNull()
  })
})
