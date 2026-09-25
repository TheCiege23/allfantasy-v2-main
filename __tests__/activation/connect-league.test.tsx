import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ facts: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/core-app/connectLeagueReads', () => ({ loadConnectLeagueFacts: h.facts }))

import {
  connectLeagueCopy,
  connectLeagueHref,
  connectLeagueStep,
  currentFantasySeason,
  POST_IMPORT_CHIMMY_PROMPT,
  postImportChimmyHref,
} from '@/lib/core-app/connectLeague'
import { ConnectLeagueCard } from '@/components/core-app/home/ConnectLeagueCard'

/**
 * 77 of 110 users had no team we could see, and the home told them "Nothing is waiting on you".
 * The card leads with the one step each of them is missing — and says nothing to anyone else.
 */

describe('which step', () => {
  it('says nothing once we know a team, whatever else is true', () => {
    expect(connectLeagueStep({ claimedTeams: 1, leagueCount: 0, verified: false })).toBe('none')
  })
  it('asks for verification first — the import refuses an unverified account', () => {
    expect(connectLeagueStep({ claimedTeams: 0, leagueCount: 0, verified: false })).toBe('verify')
    expect(connectLeagueStep({ claimedTeams: 0, leagueCount: 3, verified: false })).toBe('verify')
  })
  it('tells someone with no leagues to connect one, and someone with leagues to find their team', () => {
    expect(connectLeagueStep({ claimedTeams: 0, leagueCount: 0, verified: true })).toBe('connect')
    expect(connectLeagueStep({ claimedTeams: 0, leagueCount: 2, verified: true })).toBe('claim')
  })
  it('counts January and February toward the season that started the autumn before', () => {
    expect(currentFantasySeason(new Date('2027-01-20T00:00:00Z'))).toBe(2026)
    expect(currentFantasySeason(new Date('2027-02-28T23:00:00Z'))).toBe(2026)
    expect(currentFantasySeason(new Date('2027-03-01T00:00:00Z'))).toBe(2027)
    expect(currentFantasySeason(new Date('2026-09-25T00:00:00Z'))).toBe(2026)
  })
  it('sends a linked Sleeper account straight to its leagues', () => {
    expect(connectLeagueHref({ sleeperLinked: true })).toBe('/import?provider=sleeper')
    expect(connectLeagueHref({ sleeperLinked: false })).toBe('/import')
  })
  it('never says AI to a customer, and never promises a write', () => {
    for (const step of ['verify', 'connect', 'claim'] as const) {
      const c = connectLeagueCopy(step)
      for (const t of [c.title, c.body, c.cta]) expect(t).not.toMatch(/\bAI\b/)
    }
    expect(connectLeagueCopy('connect').body).toMatch(/Read-only/)
  })
  it('opens Chimmy in the new league with the lineup question typed', () => {
    const u = new URL(postImportChimmyHref('lg_1', 'nfl'), 'https://x.test')
    expect(u.pathname).toBe('/chimmy/chat')
    expect(u.searchParams.get('prompt')).toBe(POST_IMPORT_CHIMMY_PROMPT)
    expect(u.searchParams.get('leagueId')).toBe('lg_1')
    expect(u.searchParams.get('sport')).toBe('NFL')
    expect(new URL(postImportChimmyHref('lg_1', 'n f l<'), 'https://x.test').searchParams.get('sport')).toBeNull()
    expect(new URL(postImportChimmyHref('lg_1', null), 'https://x.test').searchParams.get('sport')).toBeNull()
  })
})

describe('ConnectLeagueCard', () => {
  const show = async (facts: unknown) => {
    h.facts.mockResolvedValue(facts)
    const el = await ConnectLeagueCard({ userId: 'u1', leagueCount: 0 })
    return render(<>{el}</>)
  }

  it('renders nothing for someone whose team we know, or when its reads failed', async () => {
    const a = await show({ claimedTeams: 2, leagueCount: 2, verified: true, sleeperLinked: false })
    expect(a.container.innerHTML).toBe('')
    const b = await show(null)
    expect(b.container.innerHTML).toBe('')
  })

  it('leads a leagueless account to the import', async () => {
    await show({ claimedTeams: 0, leagueCount: 0, verified: true, sleeperLinked: false })
    expect(screen.getByRole('heading', { name: /Connect your league/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Connect a league' }).getAttribute('href')).toBe('/import')
  })

  it('uses the linked Sleeper account when there is one, and speaks to a team it cannot find', async () => {
    await show({ claimedTeams: 0, leagueCount: 3, verified: true, sleeperLinked: true })
    expect(screen.getByRole('heading', { name: /doesn't know which team is yours/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Connect your account' }).getAttribute('href')).toBe('/import?provider=sleeper')
  })

  it('offers a fresh verification link before anything else', async () => {
    await show({ claimedTeams: 0, leagueCount: 0, verified: false, sleeperLinked: false })
    expect(screen.getByRole('button', { name: 'Send the link again' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Connect/ })).toBeNull()
  })
})

describe('ResendVerificationButton', () => {
  let reload: ReturnType<typeof vi.fn>
  beforeEach(() => {
    reload = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...window.location, reload }, configurable: true })
  })
  afterEach(() => vi.unstubAllGlobals())

  const click = async (status: number, body: unknown) => {
    const fetchMock = vi.fn(async () => ({ ok: status < 400, status, json: async () => body }))
    vi.stubGlobal('fetch', fetchMock)
    const { ResendVerificationButton } = await import('@/components/core-app/home/ResendVerificationButton')
    render(<ResendVerificationButton label="Send the link again" />)
    fireEvent.click(screen.getByRole('button', { name: 'Send the link again' }))
    return fetchMock
  }

  it('asks for a link that returns to the import, and says to check the inbox', async () => {
    const f = await click(200, { ok: true })
    await waitFor(() => expect(screen.getByText(/Check your inbox/)).toBeTruthy())
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/auth/verify-email/send')
    expect(JSON.parse(String(init.body))).toEqual({ returnTo: '/import' })
  })

  it('reloads when the account turns out to be verified already', async () => {
    await click(200, { ok: true, alreadyVerified: true })
    await waitFor(() => expect(reload).toHaveBeenCalled())
  })

  it('says to wait when rate-limited, and to retry when it failed', async () => {
    await click(429, { error: 'RATE_LIMITED' })
    await waitFor(() => expect(screen.getByText(/couple of minutes/)).toBeTruthy())
  })

  it('says it did not send', async () => {
    await click(500, {})
    await waitFor(() => expect(screen.getByText(/didn.t send/)).toBeTruthy())
  })
})
