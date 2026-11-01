import { describe, expect, it, vi } from 'vitest'
import { refreshNbaCampusWeek, nbaCampusGameMappingKey } from '@/lib/c2c/refreshNbaCampusWeek'
vi.mock('@/lib/sports-data/riScheduleCache', () => ({ readRiScheduleWindow: vi.fn(async () => [{ gameId: 'ri-1', day: '2026-11-01', homeTeamId: '1', awayTeamId: '2' }]) }))
vi.mock('@/lib/redraft/ncaabCampusTeamBridge', () => ({ bridgeNcaabCampusTeams: vi.fn(async () => ({ resolved: new Map([['10', '1']]), unresolved: [] })), bridgeRiNcaabTeams: vi.fn(async () => ({ resolved: new Map([['1', '10'], ['2', '20']]), unresolved: [] })) }))
vi.mock('@/lib/espn/refreshNcaabCollegeGameBoxes', () => ({ refreshEspnCollegeGameBoxes: vi.fn(async () => ({ matched: new Map([['ri-1', '100']]), unresolved: [], stored: 1, remaining: 0, blocked: false, error: null })) }))
describe('NBA campus week refresh', () => {
  it('limits work to saved campus schools and persists schedule-verified event mappings', async () => {
    const findMany = vi.fn().mockResolvedValue([{ data: { season: 2026, week: 2, players: [{ id: 'espn:ncaab:12', espnId: '12', teamId: '10' }] } }])
    const upsert = vi.fn().mockResolvedValue({})
    const db = { sportsDataCache: { findMany, upsert }, teamProviderIdentity: {} } as any
    const result = await refreshNbaCampusWeek(db, { season: 2026, week: 2, now: new Date('2026-11-02'), deadlineAt: Date.now() + 10000, maxEvents: 10 })
    expect(result).toMatchObject({ schools: 1, games: 1, matched: 1, boxesStored: 1 })
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { cacheKey: nbaCampusGameMappingKey(2026, 2) } }))
  })
  it('does no provider work without saved starters', async () => {
    const db = { sportsDataCache: { findMany: vi.fn().mockResolvedValue([]) }, teamProviderIdentity: {} } as any
    expect(await refreshNbaCampusWeek(db, { season: 2026, week: 2, now: new Date('2026-11-02'), deadlineAt: Date.now() + 10000, maxEvents: 10 })).toEqual({ skipped: 'no campus starters' })
  })
})
