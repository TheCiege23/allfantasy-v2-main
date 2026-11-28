/**
 * 🛑 A FINISHED SEASON LABELLED EVERY TEAM "ELIMINATED", THE TOP SEED INCLUDED.
 *
 * The playoff runtime (bracket, seeds, champion) speaks in the season's own roster ids; the standings
 * rows carry the league page's. Compared directly nothing matched, so once a bracket existed every row
 * fell through to "Eliminated", nobody read "Champion", and the bracket never marked the viewer's game.
 * Seen on a real 36-team league, 2026-11-19, the first time the table had rows to label.
 */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserLeague } from '@/app/dashboard/types'

vi.mock('@/hooks/useLeagueRealtimeRefresh', () => ({ useLeagueRealtimeRefresh: () => undefined }))
vi.mock('@/hooks/useVisibleRefresh', () => ({ useVisibleRefresh: () => undefined }))

import { NativeStandingsScreen } from '@/components/league/native/screens/NativeStandingsScreen'

afterEach(() => vi.unstubAllGlobals())

const league = { id: 'lg1', name: 'Big League', sport: 'NFL', season: 2026, currentWeek: 16, teamCount: 4, platform: 'allfantasy', format: 'redraft', leagueType: 'redraft', settings: { playoff_team_count: 2 } } as unknown as UserLeague

// The league page's ids (g-*) on the rows; the season's ids (s-*) beside them and in the runtime.
const row = (n: number, teamName: string, w: number) => ({ rosterId: `g-${n}`, seasonRosterId: `s-${n}`, teamName, wins: w, losses: 14 - w, ties: 0, pointsFor: 1000 + w, pointsAgainst: 900, rank: n })
const standings = { season: 2026, scoredWeeks: 14, viewerRosterId: 'g-2', standings: [row(1, 'One', 12), row(2, 'Two', 10), row(3, 'Three', 5), row(4, 'Four', 1)] }
const runtime = {
  playoffs: {
    seeds: [{ seed: 1, rosterId: 's-1', displayName: 'One' }, { seed: 2, rosterId: 's-2', displayName: 'Two' }],
    eliminatedRosterIds: ['s-3', 's-4'],
    bracket: {
      generated: true,
      championRosterId: 's-2',
      rounds: [{ roundId: 'f', roundNumber: 1, roundName: 'Championship', status: 'complete', matchups: [{ matchupId: 'm', homeRosterId: 's-1', awayRosterId: 's-2', homeSeed: 1, awaySeed: 2, homeScore: 99, awayScore: 101.5, winnerRosterId: 's-2', status: 'final', bye: false, complete: true }] }],
    },
  },
}

function stubFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const key = Object.keys(routes).find((k) => url.includes(k))
      return new Response(JSON.stringify(key ? routes[key] : { error: 'nope' }), { status: key ? 200 : 404 })
    }),
  )
}

describe('Standings rows and the playoff runtime speak different ids', () => {
  it('the champion, the playoff teams and the eliminated teams each get their own label', async () => {
    stubFetch({ '/scoring/standings': standings, '/playoff-runtime': runtime, '/scoring/playoff-seeds': { seeds: [] } })
    render(<NativeStandingsScreen league={league} isCommissioner={false} onSelectTab={() => {}} />)
    expect((await screen.findByTestId('native-standings-race-g-2')).textContent).toBe('Champion')
    expect(screen.getByTestId('native-standings-race-g-1').textContent).toBe('Clinched')
    expect(screen.getByTestId('native-standings-race-g-3').textContent).toBe('Eliminated')
    expect(screen.getByTestId('native-standings-race-g-4').textContent).toBe('Eliminated')
    // Only the two teams that missed the playoffs are drawn as out.
    expect(document.querySelectorAll('tr[data-rd-out]').length).toBe(2)
  })

  it('the bracket names its teams from the table and marks the viewer’s game', async () => {
    stubFetch({ '/scoring/standings': standings, '/playoff-runtime': { playoffs: { ...runtime.playoffs, seeds: [] } }, '/scoring/playoff-seeds': { seeds: [] } })
    render(<NativeStandingsScreen league={league} isCommissioner={false} onSelectTab={() => {}} />)
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Playoffs' }))
    const bracket = await screen.findByTestId('redraft-playoff-bracket-view')
    // With no seed names to fall back on, the names can only have come from the table's rows.
    expect(bracket.textContent).toContain('One')
    expect(bracket.textContent).toContain('Two')
    expect(bracket.querySelector('[data-viewer="true"], [data-mine="true"], [data-viewer]')).not.toBeNull()
  })
})
