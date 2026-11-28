// @vitest-environment node
/**
 * The core Matchup screen (also behind the league home card and the dashboard's live strip) reads an
 * OFFICIAL switching league's week from AllFantasy's schedule, never from the platform's shared
 * `WeeklyMatchup` rows. The harness is matchup-period-rollover.test.ts's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LeagueContext } from '@/lib/core-app/leagueContext'

const h = vi.hoisted(() => ({ finished: vi.fn(), rows: vi.fn(), weeks: vi.fn(), resolve: vi.fn(), official: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { weeklyMatchup: { findMany: h.rows, groupBy: h.weeks } } }))
vi.mock('@/lib/core-app/currentWeek', async original => ({ ...await original<Record<string, unknown>>(), resolveCurrentWeekForLeague: h.resolve }))
vi.mock('@/lib/core-app/finishedNflWeeks', () => ({ loadFinishedNflWeeks: h.finished }))
vi.mock('@/lib/league/switching/officialWeeklyRows', () => ({ loadOfficialWeeklyRows: h.official }))
import { getMatchupData } from '@/lib/core-app/matchup'

const stamp = { at: '2026-11-27T00:00:00.000Z', byUserId: 'commish' }
const league = { id: 'L1', name: 'L1', platform: 'sleeper', platformLeagueId: 'p1', sport: 'NFL', season: 2026, status: 'in_season' }
const context = (settings: unknown) => ({
  leagueId: league.id, userId: 'u', league: async () => ({ ...league, settings }), claimedTeam: async () => null, claimedTeams: async () => [],
}) as unknown as LeagueContext

beforeEach(() => {
  vi.resetAllMocks()
  h.resolve.mockResolvedValue({ seasonYear: 2026, week: 12 })
  h.finished.mockResolvedValue(new Set())
  h.weeks.mockResolvedValue([{ week: 11 }, { week: 12 }, { week: 13 }])
  h.rows.mockResolvedValue([])
  h.official.mockImplementation(async (_l: unknown, _y: number, filter?: { week?: number }) =>
    filter?.week ? [] : [{ week: 10 }, { week: 12 }, { week: 11 }])
})

describe('the core Matchup screen in an official switching league', () => {
  it("reads the week and the weeks on file from AllFantasy's schedule, not the platform's rows", async () => {
    const result = await getMatchupData(league.id, 'u', 12, context({ current_week: 12, switching: { official: stamp, teams: {} } }))
    expect(result?.week).toMatchObject({ available: true, data: { week: 12, season: 2026 } })
    expect(result?.weekNav).toEqual({ prev: 11, next: null })
    expect(h.official).toHaveBeenCalledWith(expect.objectContaining({ id: 'L1' }), 2026, { week: 12 })
    expect(h.rows).not.toHaveBeenCalled()
    expect(h.weeks).not.toHaveBeenCalled()
  })

  it('[control] reads the platform rows as before while the league is not official', async () => {
    const result = await getMatchupData(league.id, 'u', 12, context({ current_week: 12, switching: { official: null, teams: {} } }))
    expect(result?.weekNav).toEqual({ prev: 11, next: 13 })
    expect(h.rows).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'p1', seasonYear: 2026, week: 12 } }))
    expect(h.official).not.toHaveBeenCalled()
  })
})
