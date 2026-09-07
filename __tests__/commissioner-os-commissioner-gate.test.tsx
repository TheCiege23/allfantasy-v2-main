import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The commissioner gate on `/commissioner-os`.
 *
 * The route tree was signed-in-only, which is not the same as gated: every module in it —
 * per-manager retention risk, engagement scores, who is about to quit — is commissioner-grade
 * intelligence about OTHER PEOPLE in the league, and any signed-in league member could open it.
 *
 * Measured on prod against the 79 real accounts: 3 users resolved a league they do not commission,
 * and 6 commissioners resolved nothing in a league they own. Both are the resolver, which is why
 * these tests aim at it rather than at a separate boolean.
 */

const getServerSessionMock = vi.hoisted(() => vi.fn())
vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const prismaMock = vi.hoisted(() => ({ league: { findMany: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const cookiesMock = vi.hoisted(() => vi.fn())
vi.mock('next/headers', () => ({ cookies: cookiesMock }))

import {
  listActiveLeaguesForUser,
  resolveActiveLeagueId,
} from '@/lib/commissioner-ui/resolveActiveLeagueId'
import { CommissionerAccessNotice } from '@/components/commissioner-os/shell/CommissionerAccessNotice'

beforeEach(() => {
  vi.clearAllMocks()
  cookiesMock.mockResolvedValue({ get: () => undefined })
})

describe('commissioner gate — who resolves a league', () => {
  it('queries leagues the user OWNS, never leagues they hold a roster in', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    prismaMock.league.findMany.mockResolvedValue([{ id: 'lg-1', status: 'active', name: 'Mine' }])

    await listActiveLeaguesForUser()

    /*
     * Pinned as a where-clause assertion because the two questions return overlapping answers on
     * most fixtures — a league member who also owns their league passes either way. The clause is
     * the only thing that distinguishes them for the 3 users who do not.
     */
    expect(prismaMock.league.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    )
  })

  it('gives a commissioner their league even with no roster in it', async () => {
    // The 6 users who were locked out of their own tool: they own the league, hold no team.
    getServerSessionMock.mockResolvedValue({ user: { id: 'owner-no-roster' } })
    prismaMock.league.findMany.mockResolvedValue([{ id: 'lg-9', status: 'active', name: 'Owned' }])

    expect(await resolveActiveLeagueId()).toBe('lg-9')
    expect(await listActiveLeaguesForUser()).toEqual([{ id: 'lg-9', name: 'Owned' }])
  })

  it('resolves nothing for a signed-in non-commissioner', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'member-only' } })
    prismaMock.league.findMany.mockResolvedValue([])

    expect(await resolveActiveLeagueId()).toBeNull()
    expect(await listActiveLeaguesForUser()).toEqual([])
  })

  it('excludes archived leagues, so a finished league does not keep the tool open', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    prismaMock.league.findMany.mockResolvedValue([
      { id: 'lg-done', status: 'ARCHIVED', name: 'Done' },
      { id: 'lg-live', status: 'in_season', name: 'Live' },
    ])
    expect(await resolveActiveLeagueId()).toBe('lg-live')
  })

  it('a cookie cannot select a league the user does not commission', async () => {
    /*
     * The gate is only as strong as the override beside it. A tampered or stale cookie must not
     * reach a league outside the owned set — it is checked against the same query, never trusted.
     */
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    prismaMock.league.findMany.mockResolvedValue([{ id: 'lg-mine', status: 'active', name: 'Mine' }])
    cookiesMock.mockResolvedValue({ get: () => ({ value: 'lg-someone-elses' }) })

    expect(await resolveActiveLeagueId()).toBe('lg-mine')
  })
})

describe('commissioner gate — what a non-commissioner is told', () => {
  it('explains the rule without naming any league', () => {
    render(<CommissionerAccessNotice />)
    expect(screen.getByText(/for league commissioners/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to my leagues/i })).toBeInTheDocument()
  })

  it('renders none of the tool it is refusing', () => {
    /*
     * An access-denied screen framed in the product's own navigation invites the reader to go
     * looking for a way in, and the sidebar names every module. The notice stands alone.
     */
    const { container } = render(<CommissionerAccessNotice />)
    expect(container.querySelector('nav')).toBeNull()
    expect(screen.queryByText(/Manager Intelligence/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/League Health/i)).not.toBeInTheDocument()
  })
})
