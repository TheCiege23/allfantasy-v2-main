import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

/*
 * /join?code= is where a recap shared in a Sleeper chat sends a leaguemate. Most arrive signed out,
 * and the page used to send the join's 401 on to the creator-invite join, which answered with its own
 * error. Now: sign in or create an account, come straight back, join once, land in the league chat.
 */

const m = vi.hoisted(() => ({
  auth: 'unauthenticated' as 'authenticated' | 'unauthenticated' | 'loading',
  params: new URLSearchParams('code=ABC123'),
}))

const beacon = vi.hoisted(() => vi.fn())
vi.mock('@/lib/analytics/client', () => ({ sendProductAnalyticsBeacon: beacon }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: m.auth, data: null }) }))
vi.mock('next/navigation', () => ({ useSearchParams: () => m.params }))
vi.mock('@/components/league-join/SleeperTeamClaim', () => ({ SleeperTeamClaim: ({ leagueId }: { leagueId: string }) => <div data-testid="claim-card">{leagueId}</div> }))
vi.mock('@/components/league-join/ClassGateNotice', () => ({
  ClassGateNotice: () => null,
  isClassGateBlocked: () => false,
}))

import JoinByCodePage from '@/app/join/page'
import { inviteSource, joinCallbackUrl, joinLandingHref } from '@/lib/league-join/joinLanding'
import { RECAP_SHARE } from '@/lib/analytics/eventNames'

type Call = { url: string; init?: RequestInit }
let calls: Call[] = []
let joinResponse: { status: number; body: Record<string, unknown> } = { status: 200, body: {} }

beforeEach(() => {
  calls = []
  beacon.mockClear()
  m.auth = 'unauthenticated'
  m.params = new URLSearchParams('code=ABC123')
  joinResponse = { status: 200, body: { success: true, leagueId: 'L1', memberOnly: true, alreadyMember: false } }
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    if (String(url).startsWith('/api/leagues/join/preview')) {
      return new Response(JSON.stringify({ leagueId: 'L1', name: 'Death Squad', sport: 'NFL', requiresPassword: false }), { status: 200 })
    }
    if (String(url) === '/api/leagues/join') {
      return new Response(JSON.stringify(joinResponse.body), { status: joinResponse.status })
    }
    return new Response('{}', { status: 200 })
  }) as never
})

afterEach(() => vi.restoreAllMocks())

const joinPosts = () => calls.filter((c) => c.url === '/api/leagues/join')

describe('/join?code= for someone signed out', () => {
  it('offers sign up and sign in, each coming straight back to join', async () => {
    render(<JoinByCodePage />)
    await screen.findByTestId('league-join-signin')
    expect(screen.getByText('Join Death Squad')).toBeTruthy()
    const back = encodeURIComponent('/join?code=ABC123&go=1')
    expect(screen.getByText('Create account & join').closest('a')!.getAttribute('href')).toBe(`/signup?callbackUrl=${back}`)
    expect(screen.getByText(/sign in/i, { selector: 'a' }).getAttribute('href')).toBe(`/login?callbackUrl=${back}`)
    expect(joinPosts()).toHaveLength(0)
  })

  it('a 401 from the join shows the same sign-in, never the creator-invite error', async () => {
    m.auth = 'authenticated'
    joinResponse = { status: 401, body: { error: 'Sign in to join a league' } }
    render(<JoinByCodePage />)
    fireEvent.click(await screen.findByTestId('league-join-button'))
    await screen.findByTestId('league-join-signin')
    expect(calls.some((c) => c.url === '/api/creator-invites/join')).toBe(false)
  })
})

describe('back from signing in', () => {
  it('joins at once, exactly once, and heads for the league chat', async () => {
    m.auth = 'authenticated'
    m.params = new URLSearchParams('code=ABC123&go=1')
    render(<JoinByCodePage />)
    await screen.findByText('You’re in. Opening the league chat…')
    await waitFor(() => expect(joinPosts()).toHaveLength(1))
  })

  it('without go=1 it waits for the tap', async () => {
    m.auth = 'authenticated'
    render(<JoinByCodePage />)
    await screen.findByTestId('league-join-button')
    expect(joinPosts()).toHaveLength(0)
  })
})

describe('a Sleeper league member', () => {
  it('stays to claim their team, with the chat one tap away', async () => {
    m.auth = 'authenticated'
    m.params = new URLSearchParams('code=ABC123&go=1')
    joinResponse = { status: 200, body: { success: true, leagueId: 'L1', memberOnly: true, alreadyMember: false, sleeperClaim: true } }
    render(<JoinByCodePage />)
    await screen.findByTestId('league-join-member')
    expect(screen.getByTestId('claim-card').textContent).toBe('L1')
    expect(screen.getByText('Open the league chat').closest('a')!.getAttribute('href')).toBe('/league/L1?openChat=league')
  })
})

describe('joinLanding', () => {
  it('an imported-league member lands in the chat; a native join lands on the league', () => {
    expect(joinLandingHref({ leagueId: 'L1', memberOnly: true })).toBe('/league/L1?openChat=league')
    expect(joinLandingHref({ leagueId: 'L1' })).toBe('/league/L1')
  })
  it('the sign-in return keeps the code and joins on arrival', () => {
    expect(joinCallbackUrl('AB C')).toBe('/join?code=AB%20C&go=1')
  })
})

describe('counting invite opens and joins', () => {
  const sent = (event: string) => beacon.mock.calls.filter((c) => c[0] === event).map((c) => c[1])

  it('a signed-out open from a shared recap is counted once, and sign-in keeps src', async () => {
    m.params = new URLSearchParams('code=ABC123&src=recap')
    render(<JoinByCodePage />)
    await screen.findByTestId('league-join-signin')
    await waitFor(() => expect(sent(RECAP_SHARE.INVITE_OPEN)).toEqual([{ leagueId: 'L1', src: 'recap', signedIn: false, returning: false }]))
    const back = encodeURIComponent('/join?code=ABC123&go=1&src=recap')
    expect(screen.getByText('Create account & join').closest('a')!.getAttribute('href')).toBe(`/signup?callbackUrl=${back}`)
  })

  it('the return from signing in counts as returning, then the join is counted with its src', async () => {
    m.auth = 'authenticated'
    m.params = new URLSearchParams('code=ABC123&go=1&src=recap')
    render(<JoinByCodePage />)
    await screen.findByText('You’re in. Opening the league chat…')
    expect(sent(RECAP_SHARE.INVITE_OPEN)).toEqual([{ leagueId: 'L1', src: 'recap', signedIn: true, returning: true }])
    expect(sent(RECAP_SHARE.INVITE_JOINED)).toEqual([{ leagueId: 'L1', src: 'recap', memberOnly: true, alreadyMember: false }])
  })

  it('an ordinary invite has no src, and a strange one is dropped rather than recorded', async () => {
    m.params = new URLSearchParams('code=ABC123&src=%3Cscript%3E')
    render(<JoinByCodePage />)
    await screen.findByTestId('league-join-signin')
    await waitFor(() => expect(sent(RECAP_SHARE.INVITE_OPEN)).toEqual([{ leagueId: 'L1', src: null, signedIn: false, returning: false }]))
    expect(inviteSource('recap')).toBe('recap')
    expect(joinCallbackUrl('ABC', '<x>')).toBe('/join?code=ABC&go=1')
  })
})
