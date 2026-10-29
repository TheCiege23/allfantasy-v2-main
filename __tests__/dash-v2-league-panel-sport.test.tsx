import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}))
// The identity footer reads the settings profile; it has nothing to do with the league list.
vi.mock('@/components/core-app/dash-v2/PanelUserMenu', () => ({ PanelUserMenu: () => null }))

import { LeaguePanel } from '@/components/core-app/dash-v2/LeaguePanel'

const league = (id: string, sport: string | null, formatLabel: string | null = '2026 · 12-team') =>
  ({ id, name: `League ${id}`, platform: 'sleeper', sport, formatLabel, chips: [], priority: null }) as never

const rowSports = () => screen.queryAllByTestId('league-panel-row-sport').map((el) => el.textContent)

describe('dashboard v2 league panel sport labels', () => {
  it('names each row its sport in the ALL view when the account plays more than one', () => {
    render(<LeaguePanel leagues={[league('a', 'NFL'), league('b', 'NBA'), league('c', 'NCAAB', null)]} totalLeagues={3} />)
    expect(rowSports()).toEqual(['NFL', 'NBA', 'CBB'])
    // The separator only appears when there is a format to separate from.
    expect(screen.getByText('League a').parentElement!.textContent).toContain('NFL · 2026 · 12-team')
    expect(screen.getByText('League c').parentElement!.textContent).not.toContain('·')
  })

  it('drops the tag once a single sport is filtered, since the filter already says it', () => {
    render(<LeaguePanel leagues={[league('a', 'NFL'), league('b', 'NBA')]} totalLeagues={2} />)
    fireEvent.click(within(screen.getByRole('group', { name: 'Filter leagues by sport' })).getByRole('button', { name: 'NBA' }))
    expect(screen.queryByText('League a')).toBeNull()
    expect(rowSports()).toEqual([])
  })

  it('shows no tag for a single-sport account', () => {
    render(<LeaguePanel leagues={[league('a', 'NFL'), league('b', 'NFL')]} totalLeagues={2} />)
    expect(rowSports()).toEqual([])
  })
})
