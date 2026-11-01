import React from 'react'
import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canonicalCoreScreen, coreLeagueHref } from '@/lib/core-app/leagueNavigation'
import { leagueArtUrl } from '@/lib/core-app/leagueArt'
import { LeagueMark } from '@/components/core-app/LeagueMark'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }), usePathname: () => '/core/my-team' }))
vi.mock('next/link', () => ({ default: ({ href, prefetch, children, ...props }: any) => <a href={href} {...props}>{children}</a> }))
vi.mock('@/components/core-app/useOverlayContainment', () => ({ useOverlayContainment: () => {} }))
import { ScopeSwitcher } from '@/components/core-app/ScopeSwitcher'

afterEach(() => { cleanup(); vi.clearAllMocks() })
describe('league navigation regressions', () => {
  it.each(['roster', 'team', 'my-roster'])('opens %s as My Team instead of home', (alias) => {
    expect(canonicalCoreScreen(alias)).toBe('my-team')
    expect(coreLeagueHref('/core/' + alias, 'league & two', true)).toBe('/core/my-team?league=league%20%26%20two')
  })
  it('keeps the requested league view and drops cross-league screens', () => {
    expect(coreLeagueHref('/core/matchup', 'two', true)).toBe('/core/matchup?league=two')
    expect(coreLeagueHref('/core/portfolio', 'two', false)).toBe('/core?league=two')
  })
  it('navigates once when choosing a league and closes the picker', () => {
    render(<ScopeSwitcher leagues={[{ id: 'two', name: 'Second League', sport: 'NFL', platform: 'sleeper' }]} scopeValue={null} label="First League" selectedLeagueId="one" favoriteIds={[]} leagueScreen />)
    fireEvent.click(screen.getByRole('button', { name: /Viewing/ }))
    fireEvent.click(screen.getByRole('link', { name: /Second League/ }))
    expect(push).toHaveBeenCalledExactlyOnceWith('/core/my-team?league=two')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('opens a native league directly from Viewing', () => {
    render(<ScopeSwitcher leagues={[{ id: 'af-two', name: 'AF League', sport: 'NFL', platform: 'manual' }]} scopeValue={null} label="All leagues" selectedLeagueId={null} favoriteIds={[]} leagueScreen={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Viewing/ }))
    fireEvent.click(screen.getByRole('link', { name: /AF League/ }))
    expect(push).toHaveBeenCalledExactlyOnceWith('/league/af-two')
  })
  it('makes All leagues explicitly bypass the remembered league landing', () => {
    render(<ScopeSwitcher leagues={[]} scopeValue={null} label="All leagues" selectedLeagueId={null} favoriteIds={[]} leagueScreen={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Viewing/ }))
    expect(screen.getByRole('link', { name: /All leagues/ })).toHaveAttribute('href', '/core?view=all&scope=all')
  })
})
describe('league artwork', () => {
  it('supports local commissioner uploads and saved Sleeper avatars', () => {
    expect(leagueArtUrl({ logoUrl: '/uploads/league.png', avatarUrl: 'abc', platform: 'sleeper' })).toBe('/uploads/league.png')
    expect(leagueArtUrl({ settings: { avatar: 'abc' }, platform: 'Sleeper' })).toBe('https://sleepercdn.com/avatars/thumbs/abc')
    expect(leagueArtUrl({ avatarUrl: 'abc', platform: 'espn' })).toBeNull()
    expect(leagueArtUrl({ logoUrl: 'javascript:alert(1)' })).toBeNull()
  })
  it('tries the next league image even after the previous league image failed', () => {
    const { container, rerender } = render(<LeagueMark src="/one.png" letter="A" />)
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    rerender(<LeagueMark src="/two.png" letter="B" />)
    expect(container.querySelector('img')).toHaveAttribute('src', '/two.png')
  })
})
