/**
 * The League page (owner, 2026-11-27: "those 3 things are the only things on the league page"): a hosted
 * league's League tab is one page — this week's matchups, the standings, the activity — like Sleeper's.
 */
// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { UserLeague } from '@/app/dashboard/types'
import { buildNativeLeagueNavigation, nativeNavLeafIds } from '@/lib/league/nativeLeagueNavigation'

vi.mock('@/components/league/native/screens/NativeStandingsScreen', () => ({
  NativeStandingsScreen: () => <div data-testid="standings-stub">standings</div>,
}))
vi.mock('@/components/league/LeagueActivityTab', () => ({
  LeagueActivityTab: () => <div data-testid="activity-stub">activity</div>,
}))

import { NativeLeaguePageScreen } from '@/components/league/native/screens/NativeLeaguePageScreen'

const league = { id: 'lg1', name: 'Blah', sport: 'NBA', season: 2026, platform: 'allfantasy' } as unknown as UserLeague

const team = (rosterId: string, name: string, extra: Record<string, unknown> = {}) => ({
  rosterId, name, avatarUrl: null, record: '3-1', points: null, projected: null, isYou: false, ...extra,
})

function stubCards(status: number, body: unknown) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url)
    return new Response(JSON.stringify(body), { status })
  }))
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('NativeLeaguePageScreen', () => {
  it('shows every matchup with win chances, then standings and activity, and links to history', async () => {
    stubCards(200, {
      season: 2026,
      week: 7,
      cards: [
        { id: 'g1', label: null, status: 'upcoming', mine: true, homeWinProbability: 0.7,
          home: team('r1', 'Gridiron Ghosts', { isYou: true, projected: 120.4 }), away: team('r2', 'Night Owls', { projected: 98.1 }) },
        { id: 'g2', label: null, status: 'final', mine: false, homeWinProbability: null,
          home: team('r3', 'Bench Mob', { points: 101.5 }), away: team('r4', 'Tank Commanders', { points: 88 }) },
      ],
    })
    const onSelectTab = vi.fn()
    render(<NativeLeaguePageScreen league={league} isCommissioner={false} onSelectTab={onSelectTab} />)

    expect(await screen.findByTestId('league-page-card-g1')).toBeTruthy()
    expect(screen.getByTestId('league-page-week').textContent).toBe('Week 7')
    // Win chances add to 100, your side first; a final game has none and shows the scores.
    expect(screen.getByTestId('league-page-win-r1').textContent).toBe('70% win')
    expect(screen.getByTestId('league-page-win-r2').textContent).toBe('30% win')
    expect(screen.queryByTestId('league-page-win-r3')).toBeNull()
    expect(screen.getByTestId('league-page-score-r3').textContent).toBe('101.5')
    // An unplayed game shows no score, only its projection.
    expect(screen.getByTestId('league-page-score-r1').textContent).toBe('—')
    expect(screen.getByText('proj 120.4')).toBeTruthy()

    expect(screen.getByTestId('standings-stub')).toBeTruthy()
    expect(screen.getByTestId('activity-stub')).toBeTruthy()
    fireEvent.click(screen.getByTestId('league-page-history'))
    expect(onSelectTab).toHaveBeenCalledWith('legacy')
  })

  it('the week arrows ask for that week', async () => {
    const calls = stubCards(200, { season: 2026, week: 7, cards: [{ id: 'g1', label: null, status: 'upcoming', mine: false, homeWinProbability: null, home: team('r1', 'A'), away: team('r2', 'B') }] })
    render(<NativeLeaguePageScreen league={league} isCommissioner={false} onSelectTab={() => {}} />)
    await screen.findByTestId('league-page-card-g1')
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    await waitFor(() => expect(calls.some((u) => u.endsWith('/api/leagues/lg1/week-cards?week=6'))).toBe(true))
  })

  it('a league with no head-to-head week shows no Matchups section, but still standings and activity', async () => {
    stubCards(404, { error: 'No season' })
    render(<NativeLeaguePageScreen league={league} isCommissioner={false} onSelectTab={() => {}} />)
    await waitFor(() => expect(screen.queryByTestId('league-page-matchups')).toBeNull())
    expect(screen.getByTestId('standings-stub')).toBeTruthy()
    expect(screen.getByTestId('activity-stub')).toBeTruthy()
  })
})

describe('League nav: one page for a hosted league', () => {
  const tabs = ['native_home', 'home', 'roster', 'matchups', 'standings', 'legacy', 'league_chat', 'activity', 'settings'].map((id) => ({ id, label: id }))

  it('League has the League page only; history, activity, chat and the overview are not sub-tabs', () => {
    const groups = buildNativeLeagueNavigation(tabs, false)
    const leagueTab = groups[0].items.find((t) => t.label === 'League')!
    expect(leagueTab.children.map((c) => c.id)).toEqual(['standings'])
    const leaves = nativeNavLeafIds(groups)
    for (const id of ['legacy', 'activity', 'league_chat', 'native_home']) expect(leaves).not.toContain(id)
  })

  it('an imported league (no League home) keeps its League sub-tabs', () => {
    const imported = ['decide', 'roster', 'matchups', 'standings', 'legacy', 'activity', 'settings'].map((id) => ({ id, label: id }))
    const groups = buildNativeLeagueNavigation(imported, false)
    const leagueTab = groups[0].items.find((t) => t.label === 'League')!
    expect(leagueTab.children.map((c) => c.id)).toEqual(['standings', 'legacy', 'activity', 'decide'])
  })
})
