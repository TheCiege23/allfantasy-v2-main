/** Native Waivers screen (handoff 2026-10-11 §3): claim vs immediate add follows the existing policy. */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserLeague } from '@/app/dashboard/types'

vi.mock('@/lib/dashboard/intelligence-events', () => ({ invalidateIntelligence: () => undefined }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }) }))
vi.mock('@/components/waiver-wire/WaiverClaimDrawer', () => ({
  default: ({ open, player, faabMode, immediate, notice, nextRunLabel }: { open: boolean; player: { name: string } | null; faabMode: boolean; immediate?: boolean; notice?: string | null; nextRunLabel?: string | null }) =>
    open ? (
      <div data-testid="claim-drawer" data-immediate={immediate ? 'true' : 'false'}>
        {player?.name} · {faabMode ? 'faab' : 'priority'}
        {notice ? <p data-testid="claim-drawer-notice">{notice}</p> : null}
        {nextRunLabel ? <p data-testid="claim-drawer-run">{nextRunLabel}</p> : null}
      </div>
    ) : null,
}))

import { NativeWaiversScreen } from '@/components/league/native/screens/NativeWaiversScreen'

afterEach(() => vi.unstubAllGlobals())
const league = { id: 'lg1', name: 'Blah', sport: 'NFL', season: 2026, currentWeek: 5, teamCount: 12, platform: 'allfantasy' } as unknown as UserLeague

function stubFetch(routes: Record<string, unknown>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => url.includes(k))
    if (!key) return new Response(JSON.stringify({ error: 'nope' }), { status: 404 })
    return new Response(JSON.stringify(routes[key]), { status: 200 })
  }))
  return calls
}
const player = (id: string, name: string, position: string, projectedPoints: number) => ({ id, name, position, team: 'JAX', projectedPoints, injuryStatus: null, product: { unified: {} } })
const base = (settings: Record<string, unknown>) => ({
  '/settings': settings,
  '/players': { players: [player('p1', 'Tank Bigsby', 'RB', 11.2), player('p2', "Wan'Dale Robinson", 'WR', 10.6)] },
  '/state': { state: { nextRunAt: '2026-10-21T07:00:00.000Z' } },
  '/watchlist': { playerIds: [] },
  'claims?type=history': { claims: [], transactions: [{ id: 'x', addPlayerId: 'p1', dropPlayerId: null, faabSpent: 4, processedAt: '2026-10-14T07:00:00.000Z', roster: { id: 'other' } }] },
  '/claims': { claims: [] },
  '/api/league/roster': { rosterId: 'me', faabRemaining: 86, waiverPriority: 7, roster: { players: [{ id: 'r1', name: 'Tyjae Spears' }] }, slotLimits: { starters: 9, bench: 6 } },
  '/add-drop': { ok: true },
})

describe('NativeWaiversScreen', () => {
  it('an imported league is told up front that a claim here stays in AllFantasy; a native league is not', async () => {
    // The settings route's Write Authority (lib/league/write-authority.ts) marks an imported league `shadow`.
    stubFetch(base({ waiverType: 'faab', faabBudget: 100, writeAuthority: { shadow: true, sourceLabel: 'Fantrax' } }))
    const { unmount } = render(<NativeWaiversScreen league={{ ...league, platform: 'fantrax' } as UserLeague} />)
    await screen.findByText('Tank Bigsby')
    expect(screen.getByTestId('shadow-league-waiver-notice').textContent).toContain('nothing is submitted to Fantrax')
    unmount()

    stubFetch(base({ waiverType: 'faab', faabBudget: 100, writeAuthority: { shadow: false } }))
    render(<NativeWaiversScreen league={league} />)
    await screen.findByText('Tank Bigsby')
    expect(screen.queryByTestId('shadow-league-waiver-notice')).toBeNull()
  })

  it('a FAAB league claims through the claim drawer, never an instant add', async () => {
    const calls = stubFetch(base({ waiverType: 'faab', faabBudget: 100 }))
    render(<NativeWaiversScreen league={league} />)
    expect(await screen.findByText('Tank Bigsby')).toBeTruthy()
    expect(screen.getByText('FAAB $86 left')).toBeTruthy()
    expect(screen.getByText('Priority 7 of 12')).toBeTruthy()
    expect(screen.getByText('+2')).toBeTruthy() // one processed add in league history
    fireEvent.click(screen.getAllByRole('button', { name: 'Claim' })[0])
    expect(screen.getByTestId('claim-drawer').textContent).toContain('Tank Bigsby · faab')
    expect(calls.some((c) => c.url.includes('/add-drop'))).toBe(false)
  })

  it('a free-agent (FCFS) league adds immediately through the add-drop route', async () => {
    const calls = stubFetch(base({ waiverType: 'fcfs' }))
    render(<NativeWaiversScreen league={league} />)
    await screen.findByText('Tank Bigsby')
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0])
    await waitFor(() => expect(calls.some((c) => c.url.includes('/add-drop') && c.init?.method === 'POST')).toBe(true))
    const body = JSON.parse(String(calls.find((c) => c.url.includes('/add-drop'))!.init!.body))
    expect(body).toEqual({ addPlayerId: 'p1', dropPlayerId: null })
  })

  it('shows each player\'s headshot, team crest and season stat line — NFL and NBA', async () => {
    const nfl = {
      ...player('p1', 'Tank Bigsby', 'RB', 11.2),
      sport: 'NFL',
      headshotUrl: 'https://sleepercdn.com/content/nfl/players/9997.jpg',
      teamLogoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/jax.png',
      normalizedStats: { cacheStats: { rushing_yards: 766, rushing_touchdowns: 7, games_played: 17 } },
    }
    stubFetch({ ...base({ waiverType: 'fcfs' }), '/players': { players: [nfl] } })
    const { unmount } = render(<NativeWaiversScreen league={league} />)
    expect(await screen.findByText('Tank Bigsby')).toBeTruthy()
    expect(screen.getByAltText('Tank Bigsby').getAttribute('src')).toBe(nfl.headshotUrl)
    expect(screen.getByTestId('waiver-team-logo').getAttribute('src')).toBe(nfl.teamLogoUrl)
    // Each season figure under its own label (a labelled strip on a phone, one line on a wide screen).
    expect(screen.getByTestId('native-waivers-stats-p1').textContent).toBe('RUSH YDS766TD7')
    unmount()

    const nba = {
      id: 'n1', name: 'Jalen Brunson', position: 'PG', team: 'New York Knicks', sport: 'NBA', projectedPoints: null, injuryStatus: null,
      headshotUrl: 'https://r2.thesportsdb.com/images/media/player/cutout/mr4fe21711892054.png',
      teamLogoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/knicks.png',
      normalizedStats: { cacheStats: { points: 1927, total_rebounds: 247, assists: 503, games_played: 74 } },
      product: { unified: {} },
    }
    stubFetch({ ...base({ waiverType: 'fcfs' }), '/players': { players: [nba] } })
    render(<NativeWaiversScreen league={{ ...league, sport: 'NBA' } as UserLeague} />)
    expect(await screen.findByText('Jalen Brunson')).toBeTruthy()
    expect(screen.getByAltText('Jalen Brunson').getAttribute('src')).toBe(nba.headshotUrl)
    expect(screen.getByTestId('waiver-team-logo').getAttribute('src')).toBe(nba.teamLogoUrl)
    expect(screen.getByTestId('native-waivers-stats-n1').textContent).toBe('PTS/G26REB/G3.3AST/G6.8')
  })
})

describe('a locked instant add becomes a claim (owner report, 2026-11-28)', () => {
  function stubWithLockedAdd(settings: Record<string, unknown>) {
    const routes = base(settings) as Record<string, unknown>
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/add-drop')) {
        return new Response(JSON.stringify({ ok: false, code: 'PLAYER_LOCKED', error: 'This starter is locked because their game has started.' }), { status: 423 })
      }
      const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => url.includes(k))
      return key ? new Response(JSON.stringify(routes[key]), { status: 200 }) : new Response('{}', { status: 404 })
    }))
  }

  it('opens the claim sheet with why, when it runs, and the FAAB bid', async () => {
    // FAAB with daily free-agent unlock: the NBA default, and the owner's league. Instant adds are offered.
    stubWithLockedAdd({ waiverType: 'faab', faabBudget: 100, freeAgentUnlockBehavior: 'daily' })
    render(<NativeWaiversScreen league={league} />)
    await screen.findByText('Tank Bigsby')
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0])
    const drawer = await screen.findByTestId('claim-drawer')
    expect(drawer.getAttribute('data-immediate')).toBe('false')
    expect(screen.getByTestId('claim-drawer-notice').textContent).toContain('This starter is locked because their game has started.')
    expect(screen.getByTestId('claim-drawer-notice').textContent).toContain('next waiver run')
    expect(screen.getByTestId('claim-drawer-run').textContent).toBeTruthy()
  })

  it('CONTROL: with no waiver run to settle a claim, the add just says why it failed', async () => {
    const { toast } = await import('sonner')
    stubWithLockedAdd({ waiverType: 'fcfs' })
    vi.mocked(toast.error).mockClear()
    // An FCFS league answers no run time: drop the state's nextRunAt.
    const routes = base({ waiverType: 'fcfs' }) as Record<string, unknown>
    routes['/state'] = { state: {} }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/add-drop')) return new Response(JSON.stringify({ ok: false, code: 'PLAYER_LOCKED', error: 'Locked.' }), { status: 423 })
      const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => url.includes(k))
      return key ? new Response(JSON.stringify(routes[key]), { status: 200 }) : new Response('{}', { status: 404 })
    }))
    render(<NativeWaiversScreen league={league} />)
    await screen.findByText('Tank Bigsby')
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0])
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Locked.'))
    expect(screen.queryByTestId('claim-drawer')).toBeNull()
  })
})
