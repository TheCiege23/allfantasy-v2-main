import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/*
 * /join/[token] (pick-your-team invites) wears the Zombie hero and how-it-works for a Zombie league, around
 * its own team picker — and stays exactly as it was for every other league.
 */

const m = vi.hoisted(() => ({ auth: 'authenticated' as 'authenticated' | 'unauthenticated' | 'loading' }))

vi.mock('@/lib/analytics/client', () => ({ sendProductAnalyticsBeacon: vi.fn() }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: m.auth, data: null }) }))
vi.mock('next/navigation', () => ({
  useParams: () => ({ token: 'TOK123' }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/components/league-join/ClassGateNotice', () => ({ ClassGateNotice: () => null, isClassGateBlocked: () => false }))
vi.mock('@/components/ManagerRoleBadge', () => ({ ManagerRoleBadge: () => null }))

import JoinLeagueInvitePage from '@/app/join/[token]/page'

const ZOMBIE = {
  teamCount: 12,
  joined: 9,
  inviter: 'Guap',
  season: 2026,
  draftAt: null,
  backgroundTheme: 'quarantine-zone',
  whispererSecret: false,
  lossToZombieInfects: false,
  bashingMargin: 128,
  maulingMargin: 211,
  reviveSerums: 3,
  bashShare: 0.25,
  maulShare: 0.5,
}

const team = { id: 't1', externalId: 'e1', teamName: 'Open Team 4', ownerName: '', avatarUrl: null, role: 'member', isOrphan: false, isClaimed: false, claimEligibility: 'open' }

let payload: Record<string, unknown> = {}

beforeEach(() => {
  m.auth = 'authenticated'
  payload = { leagueId: 'L1', leagueName: 'Tip-Off Outbreak', sport: 'NBA', teamCount: 12, teams: [team], zombie: ZOMBIE }
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as never
})

afterEach(() => vi.restoreAllMocks())

describe('/join/[token] for a Zombie league', () => {
  it('shows the Zombie hero and how it works around the team picker', async () => {
    render(<JoinLeagueInvitePage />)
    await screen.findByTestId('zombie-join-hero')
    expect(screen.getByText('Guap invited you')).toBeTruthy()
    // One league-name heading: the hero's, not the card's as well.
    expect(screen.getAllByText('Tip-Off Outbreak')).toHaveLength(1)
    expect(screen.getAllByText('Open Team 4').length).toBeGreaterThan(0)
    expect(screen.getByText(/Survivor win by 128\+ is a bashing; a Zombie win by 211\+ is a mauling/)).toBeTruthy()
    expect(screen.getByText(/Survivor wins earn 2, 4 or 6 winnings units/)).toBeTruthy()
    expect(screen.queryByText(/50% goes|25% goes/)).toBeNull()
    // The league's own config: only the Whisperer infects here.
    expect(screen.getByText('Lose to the Whisperer and you join the horde. Zombies keep playing.')).toBeTruthy()
  })

  it('keeps the sign-in links for someone signed out', async () => {
    m.auth = 'unauthenticated'
    render(<JoinLeagueInvitePage />)
    await screen.findByTestId('zombie-join-hero')
    expect(screen.getAllByText('Tip-Off Outbreak')).toHaveLength(1)
    expect(screen.getByText('Sign In to Join').closest('a')!.getAttribute('href')).toBe(`/login?callbackUrl=${encodeURIComponent('/join/TOK123')}`)
  })

  it('is unchanged for a league that is not Zombie', async () => {
    payload = { ...payload, leagueName: 'Plain League', zombie: null }
    render(<JoinLeagueInvitePage />)
    await screen.findByText('Plain League')
    expect(screen.queryByTestId('zombie-join-hero')).toBeNull()
    expect(screen.queryByText('How it works')).toBeNull()
  })
})
