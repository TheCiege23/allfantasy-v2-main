import { beforeEach, describe, expect, it, vi } from 'vitest'
const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { playerSeasonStats: { findMany } } }))
import { loadStoredDraftSeasonStats } from '@/lib/draft-room/storedDraftSeasonStats'
beforeEach(() => findMany.mockReset())
describe('draft reads stored RI season statistics', () => {
  it('divides NBA totals only by known games, includes real zero rates and labels the season', async () => {
    findMany.mockResolvedValue([{ playerId: '319', season: '2026', gamesPlayed: 2, position: 'PF', stats: { games_played: 2, points: 20, rebounds: 0, minutes_played: 60 } }])
    const result = await loadStoredDraftSeasonStats('NBA', ['319'], 2026)
    expect(result.get('319')?.nbaDraftStats?.pointsPerGame).toBe(10)
    expect(result.get('319')?.nbaDraftStats?.reboundsPerGame).toBe(0)
    expect(result.get('319')?.statSeason).toBe('2026–27')
    expect(findMany.mock.calls[0]?.[0]?.where).toMatchObject({ sport: 'NBA', source: 'rolling_insights', seasonType: 'regular', playerId: { in: ['319'] } })
  })
  it('keeps MLB batting and pitching fields apart and labels a previous season', async () => {
    findMany.mockResolvedValue([{ playerId: '1', season: '2026', gamesPlayed: 100, position: 'RF', stats: { 'batting.HR': 30, 'pitching.HR': 9 } }])
    const result = await loadStoredDraftSeasonStats('MLB', ['1'], 2027)
    expect(result.get('1')?.seasonStatLine?.homeRuns).toBe(30)
    expect(result.get('1')?.statSeason).toBe('2026')
  })
  it('omits the acknowledged unreliable goalie decisions and shutouts', async () => {
    findMany.mockResolvedValue([{ playerId: '2', season: '2026', gamesPlayed: 3, position: 'G', stats: { saves: 80, shots_against: 90, win: 1, shutouts: 0 } }])
    const line = (await loadStoredDraftSeasonStats('NHL', ['2'], 2026)).get('2')?.seasonStatLine
    expect(line?.saves).toBe(80)
    expect(line?.wins).toBeUndefined(); expect(line?.shutouts).toBeUndefined()
  })
})

it('does not mistake unverified RI season units for minutes per game', async () => {
  findMany.mockResolvedValue([{ playerId: '1975', season: '2026', gamesPlayed: 2, position: 'SG', stats: { games_played: 2, points: 0, minutes: 115 } }])
  expect((await loadStoredDraftSeasonStats('NBA', ['1975'], 2026)).get('1975')?.nbaDraftStats?.minutesPerGame).toBeNull()
})
