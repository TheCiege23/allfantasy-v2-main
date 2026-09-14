// @vitest-environment node
/**
 * `getWeekAll(…, { previous: true })` — the last FULLY PLAYED week, for the weekly routine's results
 * review and recap (2026-09-14). The current week is the earliest with an unplayed row, so the week
 * before it is complete; once the whole season is played the current week itself is.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ current: vi.fn(), count: vi.fn(), matchups: vi.fn(), teams: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/core-app/currentWeek', () => ({ resolveCurrentWeek: h.current }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    weeklyMatchup: { count: h.count, findMany: h.matchups },
    leagueTeam: { findMany: h.teams },
  },
}))

import { getWeekAll } from '@/lib/core-app/weekAll'

const LEAGUES = [{ id: 'af-ice', name: 'Ice Kings', platform: 'sleeper', platformLeagueId: 'sl-ice' }]

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.teams.mockResolvedValue([{ externalId: '4', league: { id: 'af-ice', name: 'Ice Kings', platform: 'sleeper', platformLeagueId: 'sl-ice' } }])
  h.matchups.mockImplementation(async ({ where }: { where: { week: number } }) => [
    { leagueId: 'sl-ice', rosterId: '4', pointsFor: 100 + where.week, pointsAgainst: 90, win: 1 },
  ])
})

describe('getWeekAll previous', () => {
  it('🛑 the week before the one still in play', async () => {
    h.current.mockResolvedValue({ seasonYear: 2026, week: 3 })
    h.count.mockResolvedValue(5)
    const out = await getWeekAll('u1', LEAGUES, { previous: true })
    expect(h.count.mock.calls[0][0].where).toEqual({
      leagueId: { in: ['sl-ice'] },
      seasonYear: 2026,
      week: 3,
      pointsFor: { lte: 0 },
      pointsAgainst: { lte: 0 },
    })
    expect(h.matchups.mock.calls[0][0].where).toEqual({ leagueId: { in: ['sl-ice'] }, seasonYear: 2026, week: 2 })
    expect(out).toMatchObject({ season: 2026, week: 2, rows: [expect.objectContaining({ week: 2, pointsFor: 102 })] })
  })

  it('a season with every week played returns its last week', async () => {
    h.current.mockResolvedValue({ seasonYear: 2025, week: 17 })
    h.count.mockResolvedValue(0)
    expect((await getWeekAll('u1', LEAGUES, { previous: true })).week).toBe(17)
  })

  it('week 1 still unplayed has no previous week: empty, no matchup read', async () => {
    h.current.mockResolvedValue({ seasonYear: 2026, week: 1 })
    h.count.mockResolvedValue(12)
    expect(await getWeekAll('u1', LEAGUES, { previous: true })).toMatchObject({ rows: [], week: null, season: null })
    expect(h.matchups).not.toHaveBeenCalled()
  })

  it('without the option nothing changes: the current week, no extra count', async () => {
    h.current.mockResolvedValue({ seasonYear: 2026, week: 3 })
    expect((await getWeekAll('u1', LEAGUES)).week).toBe(3)
    expect(h.count).not.toHaveBeenCalled()
  })
})
