/**
 * A Survivor league's Matchup tab is the tribe race, not a head-to-head card with "no game".
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserLeague } from '@/app/dashboard/types'

vi.mock('@/hooks/useLeagueRealtimeRefresh', () => ({ useLeagueRealtimeRefresh: () => undefined }))

import { NativeMatchupScreen } from '@/components/league/native/screens/NativeMatchupScreen'

const league = { id: 'sv1', name: 'Survivor Test', sport: 'NBA', season: 2026, currentWeek: 6, platform: 'manual', leagueVariant: 'survivor', status: 'in_season', settings: {} } as unknown as UserLeague

afterEach(() => vi.unstubAllGlobals())

describe('NativeMatchupScreen in a Survivor league', () => {
  it('shows my week, the tribe race and my starters — never "no game"', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      if (url.includes('/survivor/summary')) {
        return new Response(JSON.stringify({
          currentWeek: 6, merged: false, myRosterId: 'me', myTribeId: 'kaniva', scoresFinalized: false, council: null,
          tribes: [{ id: 'kaniva', name: 'Kaniva', members: [{ rosterId: 'me', isLeader: false }] }, { id: 'koa', name: 'Koa', members: [{ rosterId: 'o1', isLeader: false }] }],
          tribeScores: { kaniva: 90, koa: 140 }, memberScores: { me: 90, o1: 140 }, immunityRosterIds: [],
          rosterDisplayNames: { me: 'TheCiege26’s Team', o1: 'Test Team 3' },
        }), { status: 200 })
      }
      if (url.includes('/matchup-center')) {
        return new Response(JSON.stringify({ payload: { left: { starters: [{ playerId: 'p1', name: 'Derrick White', position: 'PG', team: 'Boston Celtics', opponent: 'MIA', headshotUrl: null, currentPoints: 0, projectedPoints: 30, hasRealProjection: true, afProjectedPoints: 30.5, injuryStatus: 'Questionable', newsBlurb: null, weatherSummary: null, gameStatus: 'upcoming', gameLabel: 'Scheduled', aiInsight: null, outlook: { homeAway: 'home', kickoffTimeIso: null, opponentRank: null, teamLogoUrl: null, byeWeek: null, gamesThisWeek: 3, weather: null } }, { playerId: 'p2', name: 'Nikola Jokic', position: 'C', team: 'Denver Nuggets', opponent: 'LAL', headshotUrl: null, currentPoints: 61.5, projectedPoints: 55, hasRealProjection: true, afProjectedPoints: 55, injuryStatus: null, newsBlurb: null, weatherSummary: null, gameStatus: 'final', gameLabel: 'Final', aiInsight: null, outlook: null }] } } }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }))
    render(<NativeMatchupScreen league={league} onSelectTab={() => {}} />)
    expect(await screen.findByTestId('survivor-status')).toBeTruthy()
    expect(screen.getByTestId('survivor-status').textContent).toBe('Kaniva is last so far: headed to Elimination Council unless it climbs.')
    expect(screen.getByTestId('survivor-my-score').textContent).toContain('90.0')
    expect(screen.getByTestId('survivor-tribe-race').textContent).toContain('Koa')
    expect(screen.getByText('Derrick White')).toBeTruthy()
    expect(screen.getByText(/3 games/)).toBeTruthy()
    expect(screen.queryByText(/has no game/)).toBeNull()
    // Each starter's own Survivor points: a dash before his games, the counted number after.
    const pts = screen.getAllByTestId('survivor-starter-points').map((el) => el.textContent)
    expect(pts[0]).toContain('—')
    expect(pts[1]).toContain('61.5')
    expect(pts[1]).toContain('Final')
    expect(calls.some((u) => u.includes('/survivor/summary'))).toBe(true)
  })
})
