import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...(rest as Record<string, string>)}>
      {children}
    </a>
  ),
}))

import { FollowButton } from '@/components/core-app/player-finder/FollowButton'
import { FollowingBoard } from '@/components/core-app/player-finder/FollowingBoard'
import PlayerFinder from '@/components/core-app/screens/PlayerFinder'
import type { FollowingCardData } from '@/lib/core-app/followingCard'

/*
 * "My players" and "Alert me" on the Player Finder (Guap, 2026-10-08): the home leads with your
 * players, and any open card can follow him — news, and the moment he is free in one of your leagues.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

const button = (following = false) =>
  render(<FollowButton sport="NFL" sleeperId="4984" externalId="ri-7" playerName="Josh Allen" following={following} />)

describe('FollowButton', () => {
  it('follows him with the cross-league body (no leagueId) and says what he will hear', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    button()
    const b = screen.getByRole('button', { name: /Alert me about Josh Allen/ })
    expect(b).toHaveAttribute('aria-pressed', 'false')
    await act(async () => {
      fireEvent.click(b)
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/core/player-card/watch',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ sport: 'NFL', sleeperId: '4984', externalId: 'ri-7' }) }),
    )
    expect(screen.getByRole('button', { name: 'Stop following Josh Allen' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(/free to claim in one of your leagues/)
  })

  it('🛑 a refusal reverts the bell — the follow limit says so, anything else says try again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409 })))
    button()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Alert me/ }))
    })
    await waitFor(() => expect(screen.getByRole('button', { name: /Alert me/ })).toHaveAttribute('aria-pressed', 'false'))
    expect(screen.getByRole('status')).toHaveTextContent(/most players you can/)
  })

  it('unfollows with DELETE when he is already followed', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    button(true)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop following Josh Allen' }))
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/core/player-card/watch', expect.objectContaining({ method: 'DELETE' }))
    expect(screen.getByRole('button', { name: /Alert me/ })).toHaveAttribute('aria-pressed', 'false')
  })
})

const FOLLOWING: FollowingCardData = {
  total: 8,
  statusCoverage: 'ok',
  rows: [
    {
      sport: 'NFL',
      playerKey: '4984',
      sleeperId: '4984',
      externalId: 'ri-7',
      name: 'Josh Allen',
      position: 'QB',
      team: 'BUF',
      status: 'QUESTIONABLE',
      next: '@ LAR · Mon',
      freeAgentIn: [],
    },
    {
      sport: 'NFL',
      playerKey: '9999',
      sleeperId: '9999',
      externalId: null,
      name: 'Tank Dell',
      position: 'WR',
      team: 'HOU',
      status: null,
      next: null,
      freeAgentIn: [
        { leagueId: 'A', leagueName: 'KBFL', href: '/core/waivers?league=A' },
        { leagueId: 'B', leagueName: 'Maye 26', href: '/core/waivers?league=B' },
        { leagueId: 'C', leagueName: 'Dynasty', href: '/core/waivers?league=C' },
      ],
    },
  ],
}

describe('FollowingBoard', () => {
  it('each row opens his Finder card; free leagues link to that league’s waivers, two then "+N"', () => {
    render(<FollowingBoard data={FOLLOWING} />)
    expect(screen.getByRole('link', { name: /Josh Allen/ })).toHaveAttribute('href', '/core/players?q=Josh%20Allen&player=NFL%3Ari-7')
    expect(screen.getByText('QUESTIONABLE')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Free in KBFL' })).toHaveAttribute('href', '/core/waivers?league=A')
    expect(screen.getByRole('link', { name: 'Free in Maye 26' })).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Free in Dynasty' })).toBeNull()
    expect(screen.getByText('+6 more you follow')).toBeInTheDocument()
  })

  it('nothing at all when follows are unavailable; the invitation when you follow nobody', () => {
    const { container, rerender } = render(<FollowingBoard data={null} />)
    expect(container.innerHTML).toBe('')
    rerender(<FollowingBoard data={{ rows: [], total: 0, statusCoverage: 'ok' }} />)
    expect(screen.getByText(/tap “Alert me” to follow him/)).toBeInTheDocument()
  })
})

describe('Player Finder — "My players" home', () => {
  const SHARES = {
    available: true as const,
    data: { rows: [], leaguesRead: 4, playersHeld: 60, unsupportedLeagues: 0, teamSplit: null },
  }

  it('leads with My players and Following, with no empty Matches card and no "pick a match" card', () => {
    render(<PlayerFinder query="" matches={[]} detail={null} leagueCount={65} shares={SHARES} following={FOLLOWING} />)
    expect(screen.getByRole('heading', { name: 'My players' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Following' })).toBeInTheDocument()
    expect(screen.queryByText(/Matches ·/)).toBeNull()
    expect(screen.queryByText(/Pick a match/)).toBeNull()
    expect(document.querySelector('.af-pf--home')).not.toBeNull()
  })

  it('a typed query that matched nothing still says so', () => {
    render(<PlayerFinder query="zzzz" matches={[]} detail={null} leagueCount={65} shares={SHARES} following={FOLLOWING} />)
    expect(screen.getByText(/Matches · 0/)).toBeInTheDocument()
  })
})
