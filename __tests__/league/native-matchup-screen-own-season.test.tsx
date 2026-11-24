/**
 * The Matchup tab opens on the league's own week and draws the league's own games.
 *
 * It used to start on `league.currentWeek ?? 1`, read once on mount before the week had loaded, so it
 * sat on week 1 all season; and it paired a one-row-per-team list, which cannot draw a team that plays
 * twice in a week.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserLeague } from '@/app/dashboard/types'

vi.mock('@/hooks/useLeagueRealtimeRefresh', () => ({ useLeagueRealtimeRefresh: () => undefined }))

import { NativeMatchupScreen } from '@/components/league/native/screens/NativeMatchupScreen'
import { routeRefreshClaimed } from '@/components/core-app/routeRefreshClaim'

// The week has NOT loaded on the league object: exactly the state the page mounts the tab in.
const league = { id: 'lg1', name: 'Big League', sport: 'NBA', season: 2026, teamCount: 36, platform: 'manual', format: 'dynasty', settings: {} } as unknown as UserLeague

function stubFetch(routes: Record<string, (url: string) => unknown>) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url)
      const key = Object.keys(routes).find((k) => url.includes(k))
      const body = key ? routes[key](url) : null
      if (body && typeof body === 'object' && 'httpError' in body) return new Response(JSON.stringify({ error: (body as { httpError: string }).httpError }), { status: 404 })
      return new Response(JSON.stringify(body ?? {}), { status: key ? 200 : 404 })
    }),
  )
  return calls
}
afterEach(() => vi.unstubAllGlobals())

const slot = (name: string, pts: number) => ({
  playerId: name, name, position: 'PG', team: 'BOS', opponent: null, headshotUrl: null, currentPoints: pts, projectedPoints: 10, hasRealProjection: false,
  injuryStatus: null, newsBlurb: null, weatherSummary: null, gameStatus: 'final', gameLabel: 'Final', aiInsight: null,
})
const side = (rosterId: string, teamName: string, total: number, starters: unknown[]) => ({
  projectedTotalIncludesFallback: true, rosterId, teamName, avatarUrl: null, record: { wins: 1, losses: 0, ties: 0 }, winPct: 1,
  totalPoints: total, projectedTotal: 0, starters, remainingStarters: 0,
})
const insights = { matchupEdge: '', startSit: '', weather: '', injuryNews: '', swingPlayers: [], riskLevel: 'low', floorVsCeiling: '' }
const payload = (week: number, native: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  payload: {
    leagueId: 'lg1', season: 2026, week, sport: 'NBA', matchupStatus: 'final', conceptOverlay: null,
    left: side('rA', 'Aces', 681, [slot('Starter One', 400)]),
    right: side('rB', 'Bears', 718, [slot('Starter Two', 718)]),
    winProbabilityLeft: null, insights, partialData: false, refreshIntervalMs: 0,
    native: { scoreUnit: 'points', playerPointsAvailable: true, gameLabel: null, bye: false, otherGames: [], gameNumber: 1, gameCount: 1, ...native },
    ...over,
  },
})
const boardGame = (id: string, home: string, hp: number | null, away: string | null, ap: number | null, extra: Record<string, unknown> = {}) => ({
  id, kind: 'regular', label: null, status: hp == null ? 'upcoming' : 'final', mine: false,
  home: { rosterId: `${id}-h`, teamName: home, totalPoints: hp },
  away: away ? { rosterId: `${id}-a`, teamName: away, totalPoints: ap } : null,
  ...extra,
})

describe('NativeMatchupScreen on the league’s own season', () => {
  it('jumps straight to any week from the week list', async () => {
    const calls = stubFetch({
      '/matchup-center': (u) => payload(Number(new URL(u, 'http://x').searchParams.get('week') ?? 7), {}),
      '/scoring/matchups': () => ({ season: 2026, week: 7, matchups: [], games: [] }),
    })
    render(<NativeMatchupScreen league={league} onSelectTab={() => {}} />)
    await screen.findByRole('heading', { name: 'Week 7' })
    const select = screen.getByTestId('matchup-week-select') as HTMLSelectElement
    expect(select.value).toBe('7')
    fireEvent.change(select, { target: { value: '2' } })
    expect(await screen.findByRole('heading', { name: 'Week 2' })).toBeTruthy()
    expect(calls.some((u) => u.includes('/matchup-center') && u.includes('week=2'))).toBe(true)
  })

  it('🛑 asks for no week on open, and shows the week the league is on', async () => {
    const calls = stubFetch({
      '/matchup-center': () => payload(7, {}),
      '/scoring/matchups': () => ({ season: 2026, week: 7, matchups: [], games: [boardGame('g1', 'Aces', 681, 'Bears', 718, { mine: true }), boardGame('g2', 'Cubs', null, 'Ducks', null)] }),
    })
    render(<NativeMatchupScreen league={league} onSelectTab={() => {}} />)
    expect(await screen.findByRole('heading', { name: 'Week 7' })).toBeTruthy()
    expect(calls.length).toBe(2)
    expect(calls.every((u) => !u.includes('week='))).toBe(true)

    // One line per game; a game not started draws a dash, not 0.0.
    const board = screen.getByTestId('native-scoreboard')
    const lines = [...board.querySelectorAll('li')]
    expect(lines.length).toBe(2)
    expect(lines[0].getAttribute('data-mine')).toBe('true')
    expect(lines[1].textContent).toContain('Cubs')
    expect(lines[1].textContent).toContain('—')
    expect(lines[1].textContent).not.toContain('0.0')

    // Stepping back asks for the week before the one shown, not for week 0 or week 1.
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    await waitFor(() => expect(calls.some((u) => u.includes('week=6'))).toBe(true))
  })

  it('🛑 a big league’s scoreboard is a glance beside the matchup, with the full list one tap away', async () => {
    // 36 teams playing five games a week is 90 games: the list ran to nine screens beside the matchup.
    const all = Array.from({ length: 90 }, (_, i) => boardGame(`g${i}`, `Home ${i}`, 100 + i, `Away ${i}`, 90, i === 0 ? { mine: true } : {}))
    stubFetch({
      '/matchup-center': () => payload(5, {}),
      '/scoring/matchups': () => ({ season: 2026, week: 5, matchups: [], games: all }),
    })
    render(<NativeMatchupScreen league={league} onSelectTab={() => {}} />)
    const board = await screen.findByTestId('native-scoreboard')
    expect(board.querySelectorAll('li').length).toBe(8)
    expect(board.querySelector('li')?.getAttribute('data-mine')).toBe('true')
    expect(screen.getByText('8 of 90 games')).toBeTruthy()
    fireEvent.click(screen.getByTestId('native-scoreboard-all'))
    await waitFor(() => expect(screen.getByTestId('native-scoreboard').querySelectorAll('li').length).toBe(90))
    expect(screen.queryByTestId('native-scoreboard-all')).toBeNull()
  })

  it('a league whose week fits is shown whole, with no "see all"', async () => {
    stubFetch({
      '/matchup-center': () => payload(5, {}),
      '/scoring/matchups': () => ({ season: 2026, week: 5, matchups: [], games: Array.from({ length: 6 }, (_, i) => boardGame(`g${i}`, `Home ${i}`, 100, `Away ${i}`, 90)) }),
    })
    render(<NativeMatchupScreen league={league} onSelectTab={() => {}} />)
    expect((await screen.findByTestId('native-scoreboard')).querySelectorAll('li').length).toBe(6)
    expect(screen.queryByTestId('native-scoreboard-all')).toBeNull()
  })

  it('a team that plays twice in a week can open its second game', async () => {
    const calls = stubFetch({
      '/matchup-center': (url) =>
        url.includes('game=2')
          ? payload(3, { gameNumber: 2, gameCount: 2, otherGames: [boardGame('g1', 'Aces', 681, 'Bears', 718, { mine: true })] }, { right: side('rD', 'Ducks', 600, []) })
          : payload(3, { gameNumber: 1, gameCount: 2, otherGames: [boardGame('g5', 'Aces', 681, 'Ducks', 600, { mine: true })] }),
      '/scoring/matchups': () => ({ season: 2026, week: 3, matchups: [], games: [] }),
    })
    render(<NativeMatchupScreen league={league} onSelectTab={() => {}} />)
    const picker = await screen.findByTestId('native-matchup-games')
    expect(screen.getByText('Your games this week · 1 of 2')).toBeTruthy()
    expect(picker.querySelectorAll('button').length).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: 'Game 2' }))
    await waitFor(() => expect(calls.some((u) => u.includes('game=2'))).toBe(true))
    expect(await screen.findByText('Your games this week · 2 of 2')).toBeTruthy()
  })

  it('a bye draws no score card for a game nobody plays', async () => {
    stubFetch({
      '/matchup-center': () => payload(4, { bye: true, gameCount: 0, gameNumber: 0 }, { matchupStatus: 'upcoming', right: side('bye', 'No opponent', 0, []) }),
      '/scoring/matchups': () => ({ season: 2026, week: 4, matchups: [], games: [boardGame('bye', 'Aces', null, null, null, { mine: true })] }),
    })
    render(<NativeMatchupScreen league={league} onSelectTab={() => {}} />)
    expect((await screen.findByTestId('native-matchup-no-game')).textContent).toBe('Your team has a bye in week 4.')
    expect(screen.queryByText('No opponent')).toBeNull()
    expect(document.querySelector('.nls-score')).toBeNull()
  })

  it('a category league draws categories won as whole numbers and no points beside a player', async () => {
    stubFetch({
      '/matchup-center': () => payload(2, { scoreUnit: 'categories', playerPointsAvailable: false }, { left: side('rA', 'Aces', 5, [slot('Starter One', 0)]), right: side('rB', 'Bears', 4, [slot('Starter Two', 0)]) }),
      '/scoring/matchups': () => ({ season: 2026, week: 2, matchups: [], games: [] }),
    })
    render(<NativeMatchupScreen league={league} onSelectTab={() => {}} />)
    const nums = await waitFor(() => {
      const el = document.querySelector('.nls-score-nums')
      if (!el) throw new Error('no score yet')
      return el
    })
    expect([...nums.querySelectorAll('b')].map((b) => b.textContent)).toEqual(['5', '4'])
    expect([...document.querySelectorAll('.nls-pts')].map((e) => e.textContent)).toEqual(['—', '—'])
  })

  it('a starter not yet playing shows his opponent, kickoff, opponent rank, forecast and projection', async () => {
    const wx = { indoors: false, symbol: '☔', conditionLabel: 'Rain', temperatureF: 46.6, windSpeedMph: 11, precipChancePct: 70 }
    const upcoming = { ...slot('Starter One', 0), gameStatus: 'upcoming', gameLabel: 'Scheduled', opponent: 'NYG', afProjectedPoints: 20.02, headshotUrl: 'https://example.test/h.jpg',
      outlook: { homeAway: 'away', kickoffTimeIso: '2026-11-22T18:00:00.000Z', opponentRank: { rank: 28, of: 32, position: 'PG', allowedPerGame: 20.1, games: 10 }, teamLogoUrl: null, byeWeek: 7, weather: wx } }
    stubFetch({
      '/matchup-center': () => payload(7, {}, { matchupStatus: 'upcoming', left: side('rA', 'Aces', 0, [upcoming]), right: side('rB', 'Bears', 0, [slot('Starter Two', 12)]) }),
      '/scoring/matchups': () => ({ season: 2026, week: 7, matchups: [], games: [] }),
    })
    render(<NativeMatchupScreen league={league} onSelectTab={() => {}} />)
    const chip = await screen.findByTestId('matchup-opponent-rank-Starter One')
    expect(chip.textContent).toContain('vs PG 28th')
    expect(chip.getAttribute('data-tone')).toBe('easy')
    expect(screen.getByTestId('matchup-weather-Starter One').textContent).toContain('☔ 47°')
    expect(screen.getByTestId('matchup-proj-Starter One').textContent).toBe('20.0')
    const row = chip.closest('li')!
    expect(row.textContent).toContain('@ NYG')
    // His points are a dash until he plays; the projection is not his score.
    expect(row.querySelector('.nls-pts[data-side=left]')?.firstChild?.textContent).toBe('—')
    // The finished starter beside him has no chips and no projection under his score.
    expect(screen.queryByTestId('matchup-proj-Starter Two')).toBeNull()
  })

  it('a team defense shows Sleeper’s projection, named, where the AF engine has none', async () => {
    const o = { homeAway: 'home', kickoffTimeIso: null, opponentRank: null, teamLogoUrl: null, byeWeek: null, weather: null }
    const def = { ...slot('Cardinals', 0), position: 'DEF', gameStatus: 'upcoming', afProjectedPoints: null, outlook: { ...o, providerProjection: { points: 6.4, source: 'sleeper' } } }
    const qb = { ...slot('Passer', 0), gameStatus: 'upcoming', afProjectedPoints: 20.02, outlook: { ...o, providerProjection: null } }
    stubFetch({
      '/matchup-center': () => payload(7, {}, { matchupStatus: 'upcoming', left: side('rA', 'Aces', 0, [def]), right: side('rB', 'Bears', 0, [qb]) }),
      '/scoring/matchups': () => ({ season: 2026, week: 7, matchups: [], games: [] }),
    })
    render(<NativeMatchupScreen league={league} onSelectTab={() => {}} />)
    const d = await screen.findByTestId('matchup-proj-Cardinals')
    expect(d.textContent).toBe('6.4 Sleeper')
    expect(d.getAttribute('data-source')).toBe('sleeper')
    const q = screen.getByTestId('matchup-proj-Passer')
    expect(q.textContent).toBe('20.0')
    expect(q.getAttribute('data-source')).toBe('allfantasy')
  })

  it('a commissioner with no team still sees the week’s games', async () => {
    stubFetch({
      '/matchup-center': () => ({ httpError: 'You have not claimed a team in this league yet, so there is no matchup to show.' }),
      '/scoring/matchups': () => ({ season: 2026, week: 9, matchups: [], games: [boardGame('g1', 'Aces', 101.5, 'Bears', 99)] }),
    })
    render(<NativeMatchupScreen league={league} onSelectTab={() => {}} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Week 9' })).toBeTruthy()
    expect(screen.getByTestId('native-scoreboard').textContent).toContain('101.5')
  })
})

/*
 * 🛑 During a live game this screen polls its own scores every 30s, and the league page re-rendered the
 * whole page on the server on the same beat (measured 2026-11-23, MNF). While the screen polls it claims
 * the route, and LeagueShell's timer stands down; it releases the claim the moment it stops.
 */
describe('NativeMatchupScreen owns the refresh while it polls', () => {
  it('claims the route while its own score polling runs, and releases it on unmount', async () => {
    stubFetch({
      '/matchup-center': () => payload(7, {}, { matchupStatus: 'live', refreshIntervalMs: 30_000 }),
      '/scoring/matchups': () => ({ season: 2026, week: 7, matchups: [], games: [] }),
    })
    expect(routeRefreshClaimed()).toBe(false)
    const view = render(<NativeMatchupScreen league={league} onSelectTab={() => {}} />)
    await screen.findByRole('heading', { name: 'Week 7' })
    await waitFor(() => expect(routeRefreshClaimed()).toBe(true))
    view.unmount()
    expect(routeRefreshClaimed()).toBe(false)
  })

  it('[control] a screen that is not polling (a final week, interval 0) does not claim it', async () => {
    stubFetch({
      '/matchup-center': () => payload(7, {}),
      '/scoring/matchups': () => ({ season: 2026, week: 7, matchups: [], games: [] }),
    })
    const view = render(<NativeMatchupScreen league={league} onSelectTab={() => {}} />)
    await screen.findByRole('heading', { name: 'Week 7' })
    expect(routeRefreshClaimed()).toBe(false)
    view.unmount()
  })

  it('the league page timer checks the claim before re-rendering', () => {
    const shell = readFileSync(join(process.cwd(), 'app/league/[leagueId]/LeagueShell.tsx'), 'utf8')
    const timer = shell.slice(shell.indexOf('const interval = setInterval(() => {'), shell.indexOf('}, 30000)'))
    expect(timer).toMatch(/^\s*if \(routeRefreshClaimed\(\)\) return$/m)
    expect(timer.indexOf('routeRefreshClaimed()')).toBeLessThan(timer.indexOf('refresh()', timer.indexOf('routeRefreshClaimed()') + 25))
  })
})
