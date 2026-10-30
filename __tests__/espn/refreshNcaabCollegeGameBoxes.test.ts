import { describe, expect, it, vi } from 'vitest'
import { refreshEspnCollegeGameBoxes } from '@/lib/espn/refreshNcaabCollegeGameBoxes'
import { EspnBlockedError } from '@/lib/espn/espnNcaabFetch'
import type { ScheduleGame } from '@/lib/sports-data/riScheduleCache'
const game: ScheduleGame = { gameId: 'ri-1', day: '2026-11-01', startTime: null, status: 'completed', seasonType: 'regular', eventName: null, replacedBy: null, homeTeamId: '1', awayTeamId: '2' }
const scoreboard = { games: [{ id: '100', day: '2026-11-01', homeTeamId: '10', awayTeamId: '20', startTime: '2026-11-01T20:00:00Z', status: 'final' as const }], rejected: 0 }
const box = { eventId: '100', status: 'final' as const, complete: true, rejected: 0, players: [{ espnId: '12', teamId: '10', didNotPlay: true, stats: null }] }
const db = () => ({ sportsDataCache: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockResolvedValue({}) } }) as any
const input = { games: [game], espnForRi: new Map([['1', '10'], ['2', '20']]), now: new Date('2026-11-02'), deadlineAt: Date.now() + 30000, maxEvents: 5 }
describe('bounded ESPN college game refresh', () => {
  it('matches the verified slate and caches the final box', async () => {
    const d = db(); const fetchScoreboard = vi.fn().mockResolvedValue(scoreboard); const fetchBox = vi.fn().mockResolvedValue(box)
    const result = await refreshEspnCollegeGameBoxes(d, { ...input, fetchScoreboard, fetchBox })
    expect([...result.matched]).toEqual([['ri-1', '100']]); expect(result.stored).toBe(1); expect(result.unresolved).toEqual([])
  })
  it('never fetches a box for an ambiguous matchup or a scheduled game', async () => {
    const fetchBox = vi.fn().mockResolvedValue(box)
    const result = await refreshEspnCollegeGameBoxes(db(), { ...input, fetchScoreboard: vi.fn().mockResolvedValue({ ...scoreboard, games: [...scoreboard.games, { ...scoreboard.games[0], id: '101' }] }), fetchBox })
    expect(result.unresolved).toEqual(['ri-1']); expect(fetchBox).not.toHaveBeenCalled()
    await refreshEspnCollegeGameBoxes(db(), { ...input, games: [{ ...game, status: 'scheduled' }], fetchScoreboard: vi.fn().mockResolvedValue(scoreboard), fetchBox })
    expect(fetchBox).not.toHaveBeenCalled()
  })
  it('refreshes recent final boxes for corrections without repeatedly fetching fresh boxes', async () => {
    const d = db(); const fetchBox = vi.fn().mockResolvedValue(box)
    d.sportsDataCache.findMany.mockResolvedValue([{ cacheKey: 'espn:ncaab:box:100', data: { ...box, observedAt: '2026-11-01T00:00:00Z' } }])
    await refreshEspnCollegeGameBoxes(d, { ...input, fetchScoreboard: vi.fn().mockResolvedValue(scoreboard), fetchBox })
    expect(fetchBox).toHaveBeenCalledTimes(1)
    d.sportsDataCache.findMany.mockResolvedValue([{ cacheKey: 'espn:ncaab:box:100', data: { ...box, observedAt: '2026-11-01T23:00:00Z' } }])
    await refreshEspnCollegeGameBoxes(d, { ...input, fetchScoreboard: vi.fn().mockResolvedValue(scoreboard), fetchBox })
    expect(fetchBox).toHaveBeenCalledTimes(1)
  })
  it('stops on a 403 before reading box scores', async () => {
    const fetchBox = vi.fn(); const fetchScoreboard = vi.fn().mockRejectedValue(new EspnBlockedError('https://example.invalid/a'))
    const result = await refreshEspnCollegeGameBoxes(db(), { ...input, fetchScoreboard, fetchBox })
    expect(result.blocked).toBe(true); expect(fetchBox).not.toHaveBeenCalled()
  })
})
