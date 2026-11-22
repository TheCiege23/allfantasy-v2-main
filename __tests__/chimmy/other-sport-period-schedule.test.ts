import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ week: vi.fn(), ri: vi.fn(), games: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsGame: { findMany: h.games } } }))
vi.mock('@/lib/redraft/weekGames', () => ({ RI_SCHEDULE_SLATE_SPORTS: ['NCAAB', 'SOCCER', 'MLB'], readWeekGames: h.week }))
vi.mock('@/lib/sports-data/riScheduleCache', () => ({ readRiScheduleWindow: h.ri }))
vi.mock('@/lib/season-week/dailySportSeasonStarts', () => ({ resolveDailySportWeekWindow: () => ({
  start: new Date('2026-10-30T00:00:00Z'), end: new Date('2026-11-06T00:00:00Z'),
}) }))
vi.mock('@/lib/chimmy/actions/gameLocks', () => ({ windowStart: () => new Date('2026-10-30T00:00:00Z') }))
vi.mock('@/lib/redraft/lineupLock', () => ({ normalizeLockTeam: (_sport: string, team: string | null) => String(team ?? '').toUpperCase() }))
vi.mock('@/lib/scores/liveSourceSelection', () => ({ LIVE_SCORE_SOURCES: ['api_sports'] }))

import { loadOtherSportPeriodSchedule } from '@/lib/chimmy/otherSportPeriodSchedule'

const now = new Date('2026-11-01T18:00:00Z')
beforeEach(() => { vi.clearAllMocks(); h.week.mockResolvedValue([]); h.ri.mockResolvedValue([]); h.games.mockResolvedValue([]) })

describe('remaining fantasy scoring-period games', () => {
  it('counts only future NBA fixtures and names the opponents', async () => {
    h.week.mockResolvedValue([
      { homeTeam: 'BOS', awayTeam: 'NYK', startTime: new Date('2026-11-01T16:00:00Z') },
      { homeTeam: 'BOS', awayTeam: 'CHI', startTime: new Date('2026-11-03T00:00:00Z') },
    ])
    const out = await loadOtherSportPeriodSchedule({ sport: 'NBA', season: 2026, week: 2, teams: ['BOS'], now })
    expect(out?.byTeam.get('BOS')).toEqual({ count: 1, opponents: ['CHI'], verified: true })
    expect(h.week).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sport: 'NBA', season: 2026, week: 2 }))
  })

  it('requires the complete RI cache and treats a same-day game with no time as uncertain', async () => {
    h.ri.mockResolvedValue([{ gameId: '1', day: '2026-11-01', startTime: null, status: 'scheduled',
      seasonType: 'regular', replacedBy: null, homeTeam: 'Duke', awayTeam: 'UNC' }])
    const out = await loadOtherSportPeriodSchedule({ sport: 'NCAAB', season: 2026, week: 1, teams: ['Duke'], now })
    expect(out?.byTeam.get('Duke')?.verified).toBe(false)
    h.ri.mockResolvedValue(null)
    expect(await loadOtherSportPeriodSchedule({ sport: 'NCAAB', season: 2026, week: 1, teams: ['Duke'], now })).toBeNull()
  })

  it('deduplicates college football games reported by two ranked feeds', async () => {
    h.games.mockResolvedValue([
      { homeTeam: 'Duke', awayTeam: 'UNC', startTime: new Date('2026-11-02T20:00:00Z') },
      { homeTeam: 'Duke', awayTeam: 'UNC', startTime: new Date('2026-11-02T20:00:00Z') },
    ])
    const out = await loadOtherSportPeriodSchedule({ sport: 'NCAAF', season: 2026, week: 10, teams: ['Duke'], now })
    expect(out?.byTeam.get('Duke')?.count).toBe(1)
  })
})
