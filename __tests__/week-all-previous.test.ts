// @vitest-environment node
/**
 * `getWeekAll(…, { previous: true })` — the last FULLY PLAYED week, for the weekly routine's results
 * review and recap (2026-09-14). The current week is the earliest with an unplayed row, so the week
 * before it is complete; once the whole season is played the current week itself is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ current: vi.fn(), count: vi.fn(), matchups: vi.fn(), teams: vi.fn(), metadata: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/core-app/currentWeek', () => ({ resolveCurrentWeek: h.current }))
vi.mock('@/lib/core-app/leagueWeekMetadata', () => ({ readLeagueWeekMetadata: h.metadata }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    weeklyMatchup: { count: h.count, findMany: h.matchups },
    leagueTeam: { findMany: h.teams },
  },
}))

import { getWeekAll } from '@/lib/core-app/weekAll'

const LEAGUES = [{ id: 'af-ice', name: 'Ice Kings', platform: 'sleeper', platformLeagueId: 'sl-ice' }]

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-26T12:00:00Z'))
  for (const f of Object.values(h)) f.mockReset()
  h.metadata.mockResolvedValue([{ platformLeagueId: 'sl-ice', season: 2026, status: 'in_season', settings: { leg: 3 } }])
  h.teams.mockResolvedValue([{ externalId: '4', league: { id: 'af-ice', name: 'Ice Kings', platform: 'sleeper', platformLeagueId: 'sl-ice' } }])
  h.matchups.mockImplementation(async ({ where }: { where: { week: number } }) => [
    { leagueId: 'sl-ice', rosterId: '4', pointsFor: 100 + where.week, pointsAgainst: 90, win: 1 },
  ])
})
afterEach(() => vi.useRealTimers())

describe('getWeekAll previous', () => {
  it('🛑 the week before the one still in play', async () => {
    h.current.mockResolvedValue({ seasonYear: 2026, week: 3 })
    h.count.mockResolvedValue(5)
    const out = await getWeekAll('u1', LEAGUES, { previous: true })
    expect(h.count).not.toHaveBeenCalled()
    expect(h.matchups.mock.calls[0][0].where).toEqual({ leagueId: { in: ['sl-ice'] }, seasonYear: 2026, week: 2 })
    expect(out).toMatchObject({ season: 2026, week: 2, rows: [expect.objectContaining({ week: 2, pointsFor: 102 })] })
  })

  it('a season with every week played returns its last week', async () => {
    h.current.mockResolvedValue({ seasonYear: 2025, week: 17 })
    h.count.mockResolvedValue(0)
    expect((await getWeekAll('u1', LEAGUES, { previous: true })).week).toBe(17)
  })

  it('partial scores on every roster still select the previous period for recap', async () => {
    h.current.mockResolvedValue({ seasonYear: 2026, week: 3 })
    h.count.mockResolvedValue(0)
    expect((await getWeekAll('u1', LEAGUES, { previous: true })).week).toBe(2)
  })

  it('current-period points do not create a completed win or a portfolio record', async () => {
    h.current.mockResolvedValue({ seasonYear: 2026, week: 3 })
    const out = await getWeekAll('u1', LEAGUES)
    expect(out.rows[0]).toMatchObject({ pointsFor: 103, completed: false, won: false })
    expect(out.record).toBeNull()
  })

  it('unknown period metadata withholds the result even with a stored win flag', async () => {
    h.current.mockResolvedValue({ seasonYear: 2026, week: 3 })
    h.metadata.mockResolvedValue([])
    expect((await getWeekAll('u1', LEAGUES)).rows[0].completed).toBe(false)
  })

  it('a completed season returns the last period as a recorded result', async () => {
    h.current.mockResolvedValue({ seasonYear: 2026, week: 17 })
    h.metadata.mockResolvedValue([{ platformLeagueId: 'sl-ice', season: 2026, status: 'complete', settings: { leg: 17 } }])
    expect(await getWeekAll('u1', LEAGUES, { previous: true })).toMatchObject({ week: 17, record: { wins: 1, losses: 0 } })
  })

  it('a recorded tie is neither a win nor a loss', async () => {
    h.current.mockResolvedValue({ seasonYear: 2026, week: 2 })
    h.matchups.mockResolvedValue([{ leagueId: 'sl-ice', rosterId: '4', pointsFor: 100, pointsAgainst: 100, win: 0 }])
    expect(await getWeekAll('u1', LEAGUES)).toMatchObject({ rows: [{ completed: true, won: false }], record: { wins: 0, losses: 0 } })
  })

  it('week 1 still unplayed has no previous week: empty, no matchup read', async () => {
    h.current.mockResolvedValue({ seasonYear: 2026, week: 1 })
    h.metadata.mockResolvedValue([{ platformLeagueId: 'sl-ice', season: 2026, status: 'in_season', settings: { leg: 1 } }])
    h.count.mockResolvedValue(12)
    expect(await getWeekAll('u1', LEAGUES, { previous: true })).toMatchObject({ rows: [], week: null, season: null })
    expect(h.matchups).not.toHaveBeenCalled()
  })

  it('a recorded zero-zero tie is included, while a current zero-zero placeholder is not', async () => {
    h.matchups.mockResolvedValue([{ leagueId: 'sl-ice', rosterId: '4', pointsFor: 0, pointsAgainst: 0, win: 0 }])
    h.current.mockResolvedValue({ seasonYear: 2026, week: 2 })
    expect((await getWeekAll('u1', LEAGUES)).rows).toHaveLength(1)
    h.current.mockResolvedValue({ seasonYear: 2026, week: 3 })
    expect((await getWeekAll('u1', LEAGUES)).rows).toHaveLength(0)
  })

  it('negative partial scores are shown without declaring a result', async () => {
    h.current.mockResolvedValue({ seasonYear: 2026, week: 3 })
    h.matchups.mockResolvedValue([{ leagueId: 'sl-ice', rosterId: '4', pointsFor: -2, pointsAgainst: 0, win: 0 }])
    expect((await getWeekAll('u1', LEAGUES)).rows[0]).toMatchObject({ pointsFor: -2, completed: false })
  })

  it('without the option nothing changes: the current week, no extra count', async () => {
    h.current.mockResolvedValue({ seasonYear: 2026, week: 3 })
    expect((await getWeekAll('u1', LEAGUES)).week).toBe(3)
    expect(h.count).not.toHaveBeenCalled()
  })
})
