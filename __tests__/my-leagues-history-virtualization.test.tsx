import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LeagueHistoryVirtualList } from '@/components/core-app/screens/LeagueHistoryVirtualList'
import type { MyLeaguesHistoryRow } from '@/lib/core-app/myLeagues'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}))

function rows(count: number): MyLeaguesHistoryRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `history-${index}`,
    name: `League season ${index + 1}`,
    platform: index % 2 === 0 ? 'sleeper' : 'espn',
    season: String(2026 - index),
  }))
}

describe('LeagueHistoryVirtualList', () => {
  it('server-renders every row in a short history', () => {
    render(<LeagueHistoryVirtualList rows={rows(12)} />)

    expect(screen.getByRole('list', { name: '12 past seasons' })).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(12)
    expect(screen.getByText('League season 12')).toBeInTheDocument()
  })

  it('windows a large history while exposing the complete result count', () => {
    render(<LeagueHistoryVirtualList rows={rows(500)} />)

    expect(
      screen.getByRole('list', { name: '500 past seasons. Scroll to browse all results.' }),
    ).toHaveAttribute('tabindex', '0')
    expect(screen.getByText('Showing all 500 matching seasons in a fast scrolling list.')).toBeInTheDocument()
    expect(screen.getAllByRole('link').length).toBeLessThan(500)
    expect(screen.getByText('League season 1')).toBeInTheDocument()
  })
})
