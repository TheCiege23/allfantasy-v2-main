// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * /join shows the league's own refusal. A code that matched a league which said no (drafted, full,
 * link turned off) used to fall through to the creator-invite join, whose "Invalid code" replaced
 * the real reason. And /join?approved=<id> is where an approved private-league request takes its seat.
 */

const m = vi.hoisted(() => ({
  auth: 'authenticated' as 'authenticated' | 'unauthenticated' | 'loading',
  params: new URLSearchParams('code=BBALL1'),
  joinResponse: { status: 409, body: { error: 'This Best Ball league has already drafted, so there is no team left to join.', code: 'DRAFT_STARTED' } as Record<string, unknown> },
}))

vi.mock('@/lib/analytics/client', () => ({ sendProductAnalyticsBeacon: vi.fn() }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: m.auth, data: null }) }))
vi.mock('next/navigation', () => ({ useSearchParams: () => m.params }))
vi.mock('@/components/league-join/SleeperTeamClaim', () => ({ SleeperTeamClaim: () => null }))
vi.mock('@/components/league-join/ClassGateNotice', () => ({ ClassGateNotice: () => null, isClassGateBlocked: () => false }))

import JoinByCodePage from '@/app/join/page'

let calls: Array<{ url: string; body?: string }> = []

beforeEach(() => {
  calls = []
  m.auth = 'authenticated'
  m.params = new URLSearchParams('code=BBALL1')
  m.joinResponse = { status: 409, body: { error: 'This Best Ball league has already drafted, so there is no team left to join.', code: 'DRAFT_STARTED' } }
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body as string | undefined })
    if (String(url).startsWith('/api/leagues/join/preview')) {
      return new Response(JSON.stringify({ leagueId: 'L1', name: 'Spike Week', sport: 'NFL', requiresPassword: false }), { status: 200 })
    }
    if (String(url) === '/api/leagues/join') {
      return new Response(JSON.stringify(m.joinResponse.body), { status: m.joinResponse.status })
    }
    if (String(url) === '/api/creator-invites/join') {
      return new Response(JSON.stringify({ error: 'Invalid code or could not join' }), { status: 404 })
    }
    return new Response('{}', { status: 200 })
  }) as never
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('a code whose league says no', () => {
  it("shows the league's reason, not the creator-invite fallback's", async () => {
    render(<JoinByCodePage />)
    fireEvent.click(await screen.findByTestId('league-join-button'))
    expect(await screen.findByText(/Best Ball league has already drafted/)).toBeTruthy()
    expect(calls.some((c) => c.url === '/api/creator-invites/join')).toBe(false)
    expect(screen.queryByText(/Invalid code or could not join/)).toBeNull()
  })

  it('a code no league knows (404) still tries the creator invite', async () => {
    m.joinResponse = { status: 404, body: { error: 'Invalid invite code' } }
    render(<JoinByCodePage />)
    fireEvent.click(await screen.findByTestId('league-join-button'))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/creator-invites/join')).toBe(true))
  })
})

describe('/join?approved=<leagueId>', () => {
  beforeEach(() => {
    m.params = new URLSearchParams('approved=L9')
  })

  it('takes the seat with the approval, not a code', async () => {
    m.joinResponse = { status: 200, body: { success: true, leagueId: 'L9', alreadyMember: false } }
    render(<JoinByCodePage />)
    fireEvent.click(await screen.findByTestId('league-join-approved-button'))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/leagues/join')).toBe(true))
    const sent = JSON.parse(calls.find((c) => c.url === '/api/leagues/join')!.body!)
    expect(sent).toEqual({ action: 'join_approved_request', leagueId: 'L9' })
    expect(await screen.findByText('You joined the league.')).toBeTruthy()
  })

  it("shows the server's reason when the seat is gone", async () => {
    m.joinResponse = { status: 409, body: { error: 'League is full' } }
    render(<JoinByCodePage />)
    fireEvent.click(await screen.findByTestId('league-join-approved-button'))
    expect((await screen.findByTestId('league-join-approved-message')).textContent).toBe('League is full')
  })

  it('a signed-out player is sent to sign in first', async () => {
    m.auth = 'unauthenticated'
    render(<JoinByCodePage />)
    expect(screen.getByText('Sign in to take your seat').getAttribute('href')).toBe(
      `/login?callbackUrl=${encodeURIComponent('/join?approved=L9')}`,
    )
  })
})
