/** Native Lineup screen (handoff 2026-10-11 §3): optimise + per-game lock, against mocked routes. */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserLeague } from '@/app/dashboard/types'

vi.mock('@/hooks/useLeagueRealtimeRefresh', () => ({ useLeagueRealtimeRefresh: () => undefined }))
vi.mock('@/lib/league/lineup-lock', () => ({ evaluateLineupLock: () => ({ locked: false, policy: 'football_weekly' }) }))
vi.mock('@/lib/dashboard/intelligence-events', () => ({ invalidateIntelligence: () => undefined }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }) }))

import { NativeLineupScreen } from '@/components/league/native/screens/NativeLineupScreen'

afterEach(() => vi.unstubAllGlobals())

const league = { id: 'lg1', name: 'Blah', sport: 'NFL', season: 2026, currentWeek: 5, teamCount: 12, platform: 'allfantasy', format: 'redraft', settings: {} } as unknown as UserLeague

function stubFetch(routes: Record<string, unknown>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const key = Object.keys(routes).find((k) => url.includes(k))
      if (!key) return new Response(JSON.stringify({ error: 'nope' }), { status: 404 })
      return new Response(JSON.stringify(routes[key]), { status: 200 })
    }),
  )
  return calls
}

const wire = (id: string, name: string, position: string, projectedPoints: number) => ({
  id, name, position, team: 'PHI', sport: 'NFL', headshotUrl: null, imageUrl: null, teamLogoUrl: null, injuryStatus: null,
  fantasyPointsPerGame: null, projectedPoints, adp: null, aiAdp: null, aiAdpSampleSize: null, collegeClass: '', collegeClassLabel: null,
  soccerLeague: null, nflRookieIsRookie: null, nflRookieSource: null, lowConfidence: false, profileSource: null, statsSource: null,
  projectionsSource: null, normalizedStats: {}, normalizedProjections: {}, product: { unified: {}, yearsExp: null },
})
const roster = (unifiedRoster: unknown[]) => ({
  rosterId: 'ros1', leagueWeek: 5, canEditLineup: true, faabRemaining: 86, lineupLockHelp: 'Each game locks at kickoff.',
  starterSlots: [
    { index: 0, label: 'QB', allowedPositions: ['QB'], isFlexible: false },
    { index: 1, label: 'RB', allowedPositions: ['RB'], isFlexible: false },
  ],
  roster: { lineup_sections: { starters: [{ id: 'qb1' }, { id: 'rb1' }], bench: [{ id: 'rb2' }], ir: [], taxi: [], devy: [] } },
  unifiedRoster,
})
const team = { id: 't', teamName: "TheCiege26's Team", wins: 3, losses: 1, ties: 0, pointsFor: 478.6, currentRank: 2 } as never

describe('NativeLineupScreen', () => {
  it('Optimize lineup saves the best projected legal lineup through the existing save route', async () => {
    const calls = stubFetch({
      '/api/league/roster': roster([wire('qb1', 'Jalen Hurts', 'QB', 22.4), wire('rb1', 'Tyjae Spears', 'RB', 8.8), wire('rb2', 'Bijan Robinson', 'RB', 19.2)]),
      '/claims': { claims: [{ status: 'pending' }, { status: 'pending' }] },
      '/state': { state: {} },
      '/settings': { waiverType: 'faab', faabBudget: 100 },
      '/api/leagues/roster/save': { ok: true },
    })
    render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    expect(await screen.findByText('Jalen Hurts')).toBeTruthy()
    expect(screen.getByText('3–1 · 2nd place · PF 478.6')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('/ 100')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Optimize lineup' }))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/leagues/roster/save')).toBe(true))
    const body = JSON.parse(String(calls.find((c) => c.url === '/api/leagues/roster/save')!.init!.body))
    expect(body).toMatchObject({ leagueId: 'lg1', rosterId: 'ros1', week: 5 })
    expect(body.roster.starters.map((p: { id: string }) => p.id)).toEqual(['qb1', 'rb2'])
    expect(body.roster.bench.map((p: { id: string }) => p.id)).toEqual(['rb1'])
  })

  it('a player whose game has kicked off is locked and cannot be moved', async () => {
    const past = new Date(Date.now() - 3600_000).toISOString()
    stubFetch({
      '/api/league/roster': roster([{ ...wire('qb1', 'Jalen Hurts', 'QB', 22.4), nflRedraftGameContext: { isByeWeek: false, opponent: { teamAbbr: 'NYG' }, homeAway: 'home', kickoffTimeIso: past, gameStatus: 'scheduled', weather: { unavailable: true }, providerFreshness: { warnings: [] }, weatherFreshness: { warnings: [] } } }, wire('rb1', 'Tyjae Spears', 'RB', 8.8), wire('rb2', 'Bijan Robinson', 'RB', 19.2)]),
      '/claims': { claims: [] },
      '/state': { state: {} },
      '/settings': {},
    })
    render(<NativeLineupScreen league={league} userTeam={team} onSelectTab={() => {}} />)
    await screen.findByText('Jalen Hurts')
    const lockedBtn = screen.getByRole('button', { name: 'Locked' }) as HTMLButtonElement
    expect(lockedBtn.disabled).toBe(true)
    expect(screen.getByText(/PHI · vs NYG/)).toBeTruthy()
    // Moving the bench RB in offers the RB slot only; the QB never appears as a target.
    fireEvent.click(screen.getAllByRole('button', { name: 'Move' }).at(-1)!)
    expect(screen.getByText(/Start Bijan Robinson in/)).toBeTruthy()
    expect(screen.getByText('Replace Tyjae Spears')).toBeTruthy()
  })
})
