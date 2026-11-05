/**
 * Portfolio board restyle (2026-11-05): the eyebrow counts CLAIMED TEAMS (not leagues) and how many
 * you commission, the import action is the primary button, and platform groups count their rows.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Portfolio } from '@/components/core-app/screens/Portfolio'
import type { PortfolioData, PortfolioLeague } from '@/lib/core-app/portfolio'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}))

function row(id: string, platform: string, isCommissioner = false): PortfolioLeague {
  return {
    leagueId: id,
    leagueName: `League ${id}`,
    platform,
    sport: 'NFL',
    season: '2026',
    team: { name: `Team ${id}`, record: '5-3', rank: 2, teamCount: 12 },
    isCommissioner,
    rosterCount: 16,
    avatarUrl: null,
  } as PortfolioLeague
}

function data(rows: PortfolioLeague[]): PortfolioData {
  return {
    leagues: { available: true, data: rows } as PortfolioData['leagues'],
    commissionedCount: rows.filter((r) => r.isCommissioner).length,
  }
}

describe('Portfolio header', () => {
  it('counts claimed teams and commissioned leagues in the eyebrow', () => {
    render(<Portfolio data={data([row('a', 'sleeper', true), row('b', 'sleeper'), row('c', 'espn')])} />)
    expect(screen.getByTestId('portfolio-eyebrow').textContent).toBe('3 claimed teams · you commission 1')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Portfolio')
  })

  it('leaves the commission part out at zero and counts each platform group', () => {
    const { container } = render(<Portfolio data={data([row('a', 'sleeper'), row('b', 'sleeper'), row('c', 'espn')])} />)
    expect(screen.getByTestId('portfolio-eyebrow').textContent).toBe('3 claimed teams')
    const counts = [...container.querySelectorAll('.af-pf-group-count')].map((n) => n.textContent)
    expect(counts).toEqual(['2 leagues', '1 league'])
    expect(screen.getAllByRole('link', { name: 'Import a league' })[0].className).toContain('af-pf-btn--primary')
  })
})
