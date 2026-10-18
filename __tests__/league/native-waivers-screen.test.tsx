/** Native Waivers screen (handoff 2026-10-11 §3): claim vs immediate add follows the existing policy. */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserLeague } from '@/app/dashboard/types'

vi.mock('@/lib/dashboard/intelligence-events', () => ({ invalidateIntelligence: () => undefined }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }) }))
vi.mock('@/components/waiver-wire/WaiverClaimDrawer', () => ({
  default: ({ open, player, faabMode }: { open: boolean; player: { name: string } | null; faabMode: boolean }) =>
    open ? <div data-testid="claim-drawer">{player?.name} · {faabMode ? 'faab' : 'priority'}</div> : null,
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
})
