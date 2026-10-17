// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LeagueContext } from '@/lib/core-app/leagueContext'

const h = vi.hoisted(() => ({ finished: vi.fn(), rows: vi.fn(), weeks: vi.fn(), resolve: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { weeklyMatchup: { findMany: h.rows, groupBy: h.weeks } } }))
vi.mock('@/lib/core-app/currentWeek', async original => ({ ...await original<Record<string, unknown>>(), resolveCurrentWeekForLeague: h.resolve }))
vi.mock('@/lib/core-app/finishedNflWeeks', () => ({ loadFinishedNflWeeks: h.finished }))
import { getMatchupData } from '@/lib/core-app/matchup'

const league = { id: 'HailShiva', name: 'HailShiva', platform: 'sleeper', platformLeagueId: 'p1', sport: 'NFL', season: 2026, status: 'in_season', settings: { current_week: 4 } }
const context = (more = {}) => ({ leagueId: league.id, userId: 'u', league: async () => ({ ...league, ...more }), claimedTeam: async () => null, claimedTeams: async () => [] }) as unknown as LeagueContext
beforeEach(() => {
  vi.resetAllMocks()
  h.resolve.mockResolvedValue({ seasonYear: 2026, week: 4 })
  h.finished.mockResolvedValue(new Set(['2026:4']))
  h.weeks.mockResolvedValue([{ week: 4 }, { week: 5 }, { week: 18 }])
  h.rows.mockResolvedValue([])
})
describe('Matchup default period on Tuesday', () => {
  it('loads Week 5 and builds navigation around it after the marked Week 4 finishes', async () => {
    const result = await getMatchupData(league.id, 'u', null, context())
    expect(result?.week).toMatchObject({ available: true, data: { week: 5, season: 2026, isFinal: false } })
    expect(result?.weekNav).toEqual({ prev: 4, next: 18 })
    expect(h.rows).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'p1', seasonYear: 2026, week: 5 } }))
  })
  it('keeps an explicit Week 4 selection final instead of rolling it forward', async () => {
    const result = await getMatchupData(league.id, 'u', 4, context())
    expect(result?.week).toMatchObject({ data: { week: 4, isFinal: true } })
    expect(result?.weekNav).toEqual({ prev: null, next: 5 })
    expect(h.rows).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'p1', seasonYear: 2026, week: 4 } }))
  })
  it('keeps the marker when the next period is absent or schedule completion is unavailable', async () => {
    h.weeks.mockResolvedValue([{ week: 4 }, { week: 18 }])
    expect((await getMatchupData(league.id, 'u', null, context()))?.week).toMatchObject({ data: { week: 4 } })
    h.weeks.mockResolvedValue([{ week: 4 }, { week: 5 }])
    h.finished.mockResolvedValue(new Set())
    expect((await getMatchupData(league.id, 'u', null, context()))?.week).toMatchObject({ data: { week: 4, isFinal: false } })
  })
  it('does not advance another sport or a completed season', async () => {
    expect((await getMatchupData(league.id, 'u', null, context({ sport: 'NBA' })))?.week).toMatchObject({ data: { week: 4 } })
    expect((await getMatchupData(league.id, 'u', null, context({ status: 'complete' })))?.week).toMatchObject({ data: { week: 4, isFinal: true } })
  })
})
