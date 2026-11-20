/**
 * 🛑 THE MATCHUP AND STANDINGS TABS ASSUMED HEAD-TO-HEAD, AND A GUILLOTINE LEAGUE HAS NONE. Its season
 * has no matchups on purpose, so Matchup said "bye" every week and Standings ranked a field of 0-0 teams
 * with playoff seeds, never saying who had been chopped.
 */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserLeague } from '@/app/dashboard/types'

vi.mock('@/hooks/useLeagueRealtimeRefresh', () => ({ useLeagueRealtimeRefresh: () => undefined }))

import { buildSurvivalTable, isGuillotineFormat, isNativeGuillotineLeague } from '@/lib/guillotine/nativeGuillotineScreens'
import { guillyTabKind } from '@/lib/guillotine/importedGuillyView'
import { NativeMatchupScreen } from '@/components/league/native/screens/NativeMatchupScreen'
import { NativeStandingsScreen } from '@/components/league/native/screens/NativeStandingsScreen'

const league = (over: Record<string, unknown> = {}) =>
  ({ id: 'lg1', name: 'Chop Shop', sport: 'NFL', season: 2026, teamCount: 4, platform: 'manual', guillotineMode: true, leagueType: 'guillotine', lifecycleState: 'in_season', settings: {}, ...over }) as unknown as UserLeague

const summary = (over: Record<string, unknown> = {}) => ({
  weekOrPeriod: 3,
  myRosterId: 'rB',
  dangerTiers: [
    { rosterId: 'rA', displayName: 'Aces', tier: 'safe', pointsFromChopZone: 40.5 },
    { rosterId: 'rB', displayName: 'Bears', tier: 'danger', pointsFromChopZone: 6.2 },
    { rosterId: 'rC', displayName: 'Cubs', tier: 'chop_zone', pointsFromChopZone: 0 },
  ],
  survivalStandings: [
    { rosterId: 'rB', displayName: 'Bears', rank: 1, seasonPointsCumul: 250 },
    { rosterId: 'rA', displayName: 'Aces', rank: 2, seasonPointsCumul: 240 },
    { rosterId: 'rC', displayName: 'Cubs', rank: 3, seasonPointsCumul: 200 },
  ],
  chopWatch: { live: true, week: 3, chopCount: 1, chopLine: 80 },
  home: { scores: { rA: 120.5, rB: 86.2, rC: 80 }, teamCount: 4, aliveCount: 3, chopLabel: 'Wed 9:00 AM', chopped: [{ rosterId: 'rD', name: 'Ducks', week: 2, points: 71.4 }] },
  ...over,
})

function stubFetch(body: unknown, status = 200) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(url); return new Response(JSON.stringify(body), { status }) }))
  return calls
}
afterEach(() => vi.unstubAllGlobals())

describe('which leagues', () => {
  it('a league hosted here is guillotine by any of the three ways its row says so', () => {
    expect(isNativeGuillotineLeague({ platform: 'manual', guillotineMode: true })).toBe(true)
    expect(isNativeGuillotineLeague({ platform: 'manual', leagueVariant: 'guillotine' })).toBe(true)
    expect(isNativeGuillotineLeague({ platform: 'manual', leagueType: 'guillotine' })).toBe(true)
    expect(isNativeGuillotineLeague({ platform: 'manual', leagueType: 'redraft' })).toBe(false)
  })
  it('[control] an imported guillotine league keeps its own tabs', () => {
    expect(isGuillotineFormat({ leagueType: 'guillotine' })).toBe(true)
    expect(isNativeGuillotineLeague({ platform: 'sleeper', leagueType: 'guillotine', guillotineMode: true })).toBe(false)
  })
  it('🛑 a native league that only says leagueType gets its Guilly tab', () => {
    expect(guillyTabKind({ leagueType: 'guillotine' }, true)).toBe('native')
    expect(guillyTabKind({ leagueType: 'redraft' }, true)).toBeNull()
  })
})

describe('buildSurvivalTable', () => {
  it('the teams alive by season points, then the chopped, most recent first', () => {
    const t = buildSurvivalTable(summary({ home: { scores: { rA: 120.5, rB: 86.2, rC: 80 }, chopped: [{ rosterId: 'rD', name: 'Ducks', week: 2, points: 71.4 }, { rosterId: 'rE', name: 'Eels', week: 1, points: 60 }] } }))
    expect(t.alive.map((r) => [r.rank, r.name, r.seasonPoints, r.weekPoints, r.isMe])).toEqual([[1, 'Bears', 250, 86.2, true], [2, 'Aces', 240, 120.5, false], [3, 'Cubs', 200, 80, false]])
    expect(t.chopped.map((r) => [r.name, r.week])).toEqual([['Ducks', 2], ['Eels', 1]])
  })
  it('🛑 before the first chop the whole field is alive, with no total rather than a 0', () => {
    const t = buildSurvivalTable(summary({ survivalStandings: [], home: { scores: {}, chopped: [] } }))
    expect(t.alive.map((r) => r.name)).toEqual(['Aces', 'Bears', 'Cubs'])
    expect(t.alive.every((r) => r.seasonPoints === null && r.weekPoints === null)).toBe(true)
  })
  it('a chopped team is never listed as alive', () => {
    const t = buildSurvivalTable(summary({ home: { scores: {}, chopped: [{ rosterId: 'rC', name: 'Cubs', week: 3, points: 80 }] } }))
    expect(t.alive.map((r) => r.rosterId)).toEqual(['rB', 'rA'])
  })
})

describe('Matchup tab of a guillotine league', () => {
  it('🛑 draws the week against the chop line, not a bye', async () => {
    const calls = stubFetch(summary())
    render(<NativeMatchupScreen league={league()} onSelectTab={() => {}} />)
    expect(await screen.findByRole('heading', { name: 'Week 3 · The chop' })).toBeTruthy()
    expect(calls.every((u) => u.includes('/guillotine/summary'))).toBe(true)
    expect(screen.queryByTestId('native-matchup-no-game')).toBeNull()
    const rows = [...document.querySelectorAll('.nls-gl-row')]
    expect(rows.map((r) => r.querySelector('strong')?.textContent)).toEqual(['Aces', 'Bears you', 'Cubs'])
    expect(rows.map((r) => r.querySelector('.nls-gl-pts')?.textContent)).toEqual(['120.5', '86.2', '80.0'])
    // The line sits above the first team it takes.
    expect(screen.getByTestId('guillotine-chop-line').parentElement?.querySelector('strong')?.textContent).toBe('Cubs')
    expect(screen.getByTestId('guillotine-my-margin').textContent).toBe('You are 6.2 above the chop line with 86.2.')
  })
  it('before any score the teams are listed with dashes, never 0.0', async () => {
    stubFetch(summary({ home: { scores: {}, chopped: [] } }))
    render(<NativeMatchupScreen league={league()} onSelectTab={() => {}} />)
    await screen.findByText('Aces')
    expect([...document.querySelectorAll('.nls-gl-pts')].map((e) => e.textContent)).toEqual(['—', '—', '—'])
    expect(screen.queryByTestId('guillotine-my-margin')).toBeNull()
  })
  it('the Guilly button opens the Guilly tab', async () => {
    stubFetch(summary())
    const goTo = vi.fn()
    render(<NativeMatchupScreen league={league()} onSelectTab={goTo} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Guilly' }))
    expect(goTo).toHaveBeenCalledWith('guillotine')
  })
  it('[control] a league that is not guillotine still asks for its head-to-head matchup', async () => {
    const calls = stubFetch({})
    render(<NativeMatchupScreen league={league({ guillotineMode: false, leagueType: 'redraft' })} onSelectTab={() => {}} />)
    await vi.waitFor(() => expect(calls.some((u) => u.includes('/matchup-center'))).toBe(true))
    expect(calls.some((u) => u.includes('/guillotine/summary'))).toBe(false)
  })
})

describe('Standings tab of a guillotine league', () => {
  it('🛑 lists who is alive and who was chopped, with no record and no playoffs', async () => {
    const calls = stubFetch(summary())
    render(<NativeStandingsScreen league={league()} isCommissioner={false} onSelectTab={() => {}} />)
    expect(await screen.findByRole('heading', { name: 'Survival standings' })).toBeTruthy()
    expect(calls.every((u) => u.includes('/guillotine/summary'))).toBe(true)
    expect(screen.getByTestId('guillotine-alive-rB').textContent).toBe('1Bears86.2250.0')
    expect(screen.getByTestId('guillotine-alive-rB').getAttribute('data-viewer')).toBe('true')
    expect(screen.getByTestId('guillotine-chopped-table').textContent).toContain('Ducks271.4')
    expect(document.body.textContent).not.toMatch(/playoff seed|W-L|Clinched/i)
  })
  it('[control] a league that is not guillotine reads the ordinary standings', async () => {
    const calls = stubFetch({ standings: [] })
    render(<NativeStandingsScreen league={league({ guillotineMode: false, leagueType: 'redraft' })} isCommissioner={false} onSelectTab={() => {}} />)
    await vi.waitFor(() => expect(calls.some((u) => u.includes('/scoring/standings'))).toBe(true))
    expect(calls.some((u) => u.includes('/guillotine/summary'))).toBe(false)
  })
})
