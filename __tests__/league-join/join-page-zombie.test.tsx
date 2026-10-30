import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/*
 * A Zombie league's invite (`/join?code=`, the existing route) shows the Zombie hero and how-it-works,
 * with the engine's numbers from the preview — and still joins through the same flow.
 */

const m = vi.hoisted(() => ({
  auth: 'unauthenticated' as 'authenticated' | 'unauthenticated' | 'loading',
  params: new URLSearchParams('code=ZMB123'),
}))

vi.mock('@/lib/analytics/client', () => ({ sendProductAnalyticsBeacon: vi.fn() }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: m.auth, data: null }) }))
vi.mock('next/navigation', () => ({ useSearchParams: () => m.params }))
vi.mock('@/components/league-join/SleeperTeamClaim', () => ({ SleeperTeamClaim: () => null }))
vi.mock('@/components/league-join/ClassGateNotice', () => ({ ClassGateNotice: () => null, isClassGateBlocked: () => false }))

import JoinByCodePage from '@/app/join/page'

const ZOMBIE = {
  teamCount: 12,
  joined: 9,
  inviter: 'Guap',
  season: 2026,
  draftAt: null,
  backgroundTheme: 'quarantine-zone',
  whispererSecret: true,
  lossToZombieInfects: true,
  bashingMargin: 128,
  maulingMargin: 211,
  reviveSerums: 3,
  bashShare: 0.25,
  maulShare: 0.5,
}

let calls: string[] = []

beforeEach(() => {
  calls = []
  m.auth = 'unauthenticated'
  globalThis.fetch = vi.fn(async (url: string) => {
    calls.push(String(url))
    if (String(url).startsWith('/api/leagues/join/preview')) {
      return new Response(
        JSON.stringify({ leagueId: 'L1', name: 'Tip-Off Outbreak', sport: 'NBA', requiresPassword: false, zombie: ZOMBIE }),
        { status: 200 },
      )
    }
    if (String(url) === '/api/leagues/join') {
      return new Response(JSON.stringify({ success: true, leagueId: 'L1' }), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  }) as never
})

afterEach(() => vi.restoreAllMocks())

describe('/join?code= for a Zombie league', () => {
  it('shows the Zombie hero and how it works, with the engine numbers', async () => {
    render(<JoinByCodePage />)
    await screen.findByTestId('zombie-join')
    expect(screen.getByText('Tip-Off Outbreak')).toBeTruthy()
    expect(screen.getByText('Guap invited you')).toBeTruthy()
    expect(screen.getByText(/lose by 211\+ and 50% goes, by 128\+ and 25%/)).toBeTruthy()
    expect(screen.getByText(/Collect 3 serums/)).toBeTruthy()
    expect(screen.getByText(/secret Whisperers/)).toBeTruthy()
    const back = encodeURIComponent('/join?code=ZMB123&go=1')
    expect(screen.getByText('Create account and join').closest('a')!.getAttribute('href')).toBe(`/signup?callbackUrl=${back}`)
  })

  it('joins through the same flow when signed in', async () => {
    m.auth = 'authenticated'
    render(<JoinByCodePage />)
    const button = await screen.findByTestId('league-join-button')
    expect(button.textContent).toContain('3 spots left')
    fireEvent.click(button)
    await waitFor(() => expect(calls).toContain('/api/leagues/join'))
  })
})
