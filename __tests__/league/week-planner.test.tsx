/**
 * "Games this week" — the streaming planner (2026-11-27).
 *
 *   lib/league/weekPlanner.ts                    fixtures -> team rows, light nights, games left
 *   app/api/leagues/[leagueId]/week-planner      members only; team spellings -> planner codes
 *   WeekPlannerCard / GamesLeftChip              the card and the waiver-row chip
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const auth = vi.hoisted(() => ({ userId: 'me' as string | null, member: true }))
const load = vi.hoisted(() => ({ fn: vi.fn() }))
const db = vi.hoisted(() => ({ league: { findUnique: vi.fn() } }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: vi.fn(async () => ({ appUserId: auth.userId, legacyUsername: null })) }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn(async () => (auth.member ? { isMember: true } : null)) }))
vi.mock('@/lib/league/weekPlannerLoad', () => ({ PLANNER_SPORTS: ['NHL', 'NBA', 'NCAAB', 'MLB', 'SOCCER'], loadWeekPlanner: load.fn }))

import { buildWeekPlanner, plannerTeamCode, type PlannerFixture } from '@/lib/league/weekPlanner'
import { GET } from '@/app/api/leagues/[leagueId]/week-planner/route'
import { GamesLeftChip, WeekPlannerCard, useWeekPlanner } from '@/components/league/native/screens/WeekPlannerCard'

// Week of Mon 23 Nov .. Sun 29 Nov 2026, as Eastern-day keys.
const window = { start: new Date('2026-11-23T00:00:00Z'), end: new Date('2026-11-30T00:00:00Z') }
// 7pm Eastern on a day = 00:00 UTC the next day: the bucketing trap weekGames.ts records.
const et7pm = (day: string) => new Date(new Date(`${day}T00:00:00Z`).getTime() + 24 * 3600_000)
const g = (day: string, home: string, away: string): PlannerFixture => ({ home, away, start: et7pm(day) })

function week(): PlannerFixture[] {
  const busy = (day: string) => [g(day, 'BOS', 'NYR'), g(day, 'CHI', 'DAL'), g(day, 'EDM', 'CGY'), g(day, 'VAN', 'SEA'), g(day, 'MTL', 'OTT'), g(day, 'PIT', 'PHI')]
  return [
    // Monday light: one game, Toronto plays.
    g('2026-11-23', 'TOR', 'BUF'),
    ...busy('2026-11-24'),
    g('2026-11-25', 'TOR', 'DET'),
    ...busy('2026-11-26'),
    g('2026-11-27', 'BUF', 'TOR'),
    ...busy('2026-11-28'),
    ...busy('2026-11-29'),
    // The same Toronto game from a second feed, full-name spelling: counted once.
    { home: 'Toronto Maple Leafs', away: 'Buffalo Sabres', start: et7pm('2026-11-23') },
  ]
}

describe('buildWeekPlanner', () => {
  const now = new Date('2026-11-25T17:00:00Z') // Wednesday noon Eastern

  it('buckets by Eastern day, counts each game once, and finds the light nights', () => {
    const p = buildWeekPlanner({ sport: 'NHL', week: 8, window, fixtures: week(), now })!
    expect(p.days.map((d) => d.games)).toEqual([1, 6, 1, 6, 1, 6, 6])
    expect(p.days.filter((d) => d.light).map((d) => d.day)).toEqual(['2026-11-23', '2026-11-25', '2026-11-27'])
    expect(p.days.map((d) => d.status)).toEqual(['past', 'past', 'today', 'future', 'future', 'future', 'future'])
    const tor = p.teams.find((t) => t.team === plannerTeamCode('NHL', 'TOR'))!
    expect(tor.count).toBe(3)
    expect(tor.games.map((x) => `${x.home ? '' : '@'}${x.opponent}`)).toEqual(['BUF', 'DET', '@BUF'])
  })

  it('counts what is left, how much of it is on light nights, and sorts by that', () => {
    const p = buildWeekPlanner({ sport: 'NHL', week: 8, window, fixtures: week(), now })!
    const tor = p.teams.find((t) => t.label === 'TOR')!
    // Monday is played; Wednesday 7pm and Friday are to come, both light nights.
    expect([tor.remaining, tor.lightRemaining]).toEqual([2, 2])
    const bos = p.teams.find((t) => t.label === 'BOS')!
    expect([bos.count, bos.remaining, bos.lightRemaining]).toEqual([4, 3, 0])
    expect(p.teams[0].remaining).toBeGreaterThanOrEqual(p.teams.at(-1)!.remaining)
  })

  it('maps two feeds’ spellings of a team to one code', () => {
    expect(plannerTeamCode('NHL', 'Toronto Maple Leafs')).toBe(plannerTeamCode('NHL', 'TOR'))
  })

  it('is null when the week holds no games', () => {
    expect(buildWeekPlanner({ sport: 'NHL', week: 8, window, fixtures: [], now })).toBeNull()
  })
})

describe('GET /api/leagues/[leagueId]/week-planner', () => {
  const call = (qs = '') => GET(new Request(`http://x/api/leagues/L1/week-planner${qs}`), { params: Promise.resolve({ leagueId: 'L1' }) })
  beforeEach(() => {
    auth.userId = 'me'
    auth.member = true
    db.league.findUnique.mockResolvedValue({ sport: 'NHL', season: 2026 })
    load.fn.mockReset().mockResolvedValue({ sport: 'NHL', week: 8, days: [], teams: [] })
  })

  it('answers members, with next week on offset=1 and each team spelling mapped', async () => {
    const res = await call('?offset=1&team=Toronto%20Maple%20Leafs&team=TOR')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(load.fn).toHaveBeenCalledWith({ sport: 'NHL', season: 2026, offset: 1 })
    expect(body.teamCodes['Toronto Maple Leafs']).toBe(body.teamCodes.TOR)
  })

  it('refuses outsiders and has no planner for a weekly sport', async () => {
    auth.member = false
    expect((await call()).status).toBe(403)
    auth.member = true
    db.league.findUnique.mockResolvedValue({ sport: 'NFL', season: 2026 })
    expect(await (await call()).json()).toEqual({ planner: null })
    expect(load.fn).not.toHaveBeenCalled()
  })
})

describe('WeekPlannerCard and GamesLeftChip', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })
  const planner = buildWeekPlanner({ sport: 'NHL', week: 8, window, fixtures: week(), now: new Date('2026-11-25T17:00:00Z') })!

  it('names the light nights, opens to the grid, and switches to next week', () => {
    const onOffset = vi.fn()
    render(<WeekPlannerCard planner={planner} offset={0} onOffset={onOffset} />)
    expect(screen.getByText(/Light nights: Mon, Wed, Fri/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Games this week/ }))
    // Collapsed to the eight teams with the most games left; Toronto (2 left) is below them.
    expect(screen.queryByTestId(`week-planner-${plannerTeamCode('NHL', 'TOR')}`)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Show all \d+ teams/ }))
    const tor = screen.getByTestId(`week-planner-${plannerTeamCode('NHL', 'TOR')}`)
    expect(tor.textContent).toContain('2/3')
    expect(tor.textContent).toContain('@BUF')
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(onOffset).toHaveBeenCalledWith(1)
  })

  it('a chip says how many games are left, and nothing for a team it does not know', () => {
    const tor = planner.teams.find((t) => t.label === 'TOR')!
    const { container } = render(<><GamesLeftChip team={tor} compact /><GamesLeftChip team={null} /></>)
    expect(screen.getByTestId('games-left-chip').textContent).toContain('2 left')
    expect(container.querySelectorAll('[data-testid="games-left-chip"]')).toHaveLength(1)
  })

  it('the hook asks once with the screen’s team spellings and matches them back', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ planner, teamCodes: { 'Toronto Maple Leafs': plannerTeamCode('NHL', 'TOR') } })))
    vi.stubGlobal('fetch', fetchMock)
    function Row() {
      const { teamFor } = useWeekPlanner('L1', 'NHL', ['Toronto Maple Leafs', 'Toronto Maple Leafs'])
      return <GamesLeftChip team={teamFor('Toronto Maple Leafs')} compact />
    }
    render(<Row />)
    await waitFor(() => expect(screen.getByTestId('games-left-chip').textContent).toContain('2 left'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('team=Toronto+Maple+Leafs')
  })
})
