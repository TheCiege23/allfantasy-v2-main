/**
 * A rotisserie league on the native Matchup and Standings screens. Roto has no weekly opponent (the
 * engine pins every matchup score to 0) and no W–L, so the head-to-head screens would show a 0.0 vs
 * 0.0 matchup and a table of zeros. These pin what a roto league shows instead.
 */
import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserLeague } from '@/app/dashboard/types'

vi.mock('@/hooks/useLeagueRealtimeRefresh', () => ({ useLeagueRealtimeRefresh: () => undefined }))

import { NativeMatchupScreen } from '@/components/league/native/screens/NativeMatchupScreen'
import { NativeStandingsScreen } from '@/components/league/native/screens/NativeStandingsScreen'

const rotoLeague = {
  id: 'lg-roto',
  name: 'Hoops Roto',
  sport: 'NBA',
  season: 2026,
  currentWeek: 3,
  teamCount: 3,
  platform: 'allfantasy',
  format: 'redraft',
  settings: { scoring_mode: 'roto', category_preset_id: 'nba_9cat', category_record_mode: 'roto' },
} as unknown as UserLeague

function stubFetch(routes: Record<string, unknown>) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url)
      const key = Object.keys(routes).find((k) => url.includes(k))
      if (!key) return new Response(JSON.stringify({ error: 'nope' }), { status: 404 })
      return new Response(JSON.stringify(routes[key]), { status: 200 })
    }),
  )
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('NativeMatchupScreen in a rotisserie league', () => {
  it('shows no head-to-head matchup, fetches none, and points at the standings', () => {
    const calls = stubFetch({})
    const onSelectTab = vi.fn()
    render(<NativeMatchupScreen league={rotoLeague} onSelectTab={onSelectTab} />)
    expect(screen.getByText('No weekly matchup')).toBeTruthy()
    expect(screen.queryByText(/win prob/i)).toBeNull()
    expect(calls).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'View category standings' }))
    expect(onSelectTab).toHaveBeenCalledWith('standings')
  })
})

describe('NativeStandingsScreen in a rotisserie league', () => {
  it('ranks by roto points with no W–L, odds or power views', async () => {
    stubFetch({
      '/scoring/standings': {
        season: 2026,
        scoredWeeks: 2,
        scoringMode: 'roto',
        viewerRosterId: 'r2',
        standings: [
          { rosterId: 'r1', teamName: 'Alpha', wins: 0, losses: 0, ties: 0, pointsFor: 22.5, pointsAgainst: 0, rank: 1 },
          { rosterId: 'r2', teamName: 'Bravo', wins: 0, losses: 0, ties: 0, pointsFor: 18, pointsAgainst: 0, rank: 2 },
        ],
      },
      '/season-forecast': { teamForecasts: null },
      '/scoring/playoff-seeds': { seeds: [] },
    })
    render(<NativeStandingsScreen league={rotoLeague} isCommissioner={false} onSelectTab={() => {}} />)
    const table = await screen.findByRole('table')
    const header = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(header).toEqual(['#', 'Team', 'Roto pts'])
    expect(within(table).getByText('22.5')).toBeTruthy()
    expect(screen.queryByText('W–L')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Power rankings' })).toBeNull()
    expect(screen.getByText(/You are 2nd with 18\.0 rotisserie points/)).toBeTruthy()
  })
})
