import { describe, expect, it, vi } from 'vitest'
import { nbaCampusPointsForMatchup } from '@/lib/c2c/nbaCampusMatchupScoring'
import { nbaCampusWeekCacheKey } from '@/lib/c2c/storeNbaCampusWeekSnapshot'
import { nbaCampusGameMappingKey } from '@/lib/c2c/refreshNbaCampusWeek'
const game = { gameId: 'ri-1', day: '2026-11-01', startTime: '2026-11-01T18:00:00Z', status: 'completed', seasonType: 'regular', eventName: null, replacedBy: null, homeTeamId: '1', awayTeamId: '2' }
vi.mock('@/lib/sports-data/riScheduleCache', async (load) => ({ ...(await load<typeof import('@/lib/sports-data/riScheduleCache')>()), readRiScheduleWindow: vi.fn(async () => [game]) }))
vi.mock('@/lib/redraft/ncaabCampusTeamBridge', () => ({ bridgeNcaabCampusTeams: vi.fn(async () => ({ resolved: new Map([['10', '1']]), unresolved: [] })) }))
const key = nbaCampusWeekCacheKey('l', 'home-af', 2026, 2)
const snapshot = (selectedAt = '2026-10-31T12:00:00Z') => ({ season: 2026, week: 2, savedAt: selectedAt, players: [{ id: 'espn:ncaab:12', espnId: '12', teamId: '10', position: 'G', selectedAt, observedAt: '2026-10-30T12:00:00Z' }] })
const box = { eventId: '100', status: 'final', complete: true, rejected: 0, players: [{ espnId: '12', teamId: '10', didNotPlay: false, stats: { pts: 20, reb: 5, ast: 0, to: 0, stl: 0, blk: 0, threes: 0 } }] }
function db(snapshotData = snapshot(), boxData: unknown = box) {
 const values = new Map<string, unknown>([[key, snapshotData], [nbaCampusWeekCacheKey('l', 'away-af', 2026, 2), { season: 2026, week: 2, players: [] }], [nbaCampusGameMappingKey(2026, 2), { season: 2026, week: 2, mappings: [{ gameId: 'ri-1', eventId: '100', day: game.day, homeTeamId: '1', awayTeamId: '2' }] }], ['NCAAB:rischedule:2026:meta', { firstDay: '2026-11-01', lastDay: '2027-03-07' }], ['espn:ncaab:box:100', boxData]])
 return { roster: { findMany: vi.fn().mockResolvedValue([{ id: 'home-af', redraftRosterId: 'home', playerData: {} }, { id: 'away-af', redraftRosterId: 'away', playerData: {} }]) }, afRosterLineupAssignment: { findMany: vi.fn().mockResolvedValue([{ rosterId: 'home-af', playerId: 'espn:ncaab:12', section: 'campus' }, { rosterId: 'away-af', playerId: 'pro', section: 'starters' }]) }, sportsDataCache: { findMany: vi.fn(async ({ where }: any) => where.cacheKey.in.filter((k: string) => values.has(k)).map((cacheKey: string) => ({ cacheKey, data: values.get(cacheKey) }))) }, teamProviderIdentity: {} } as any
}
const input = { leagueId: 'l', season: 2026, week: 2, homeRosterId: 'home', awayRosterId: 'away', now: new Date('2026-11-05T12:00:00Z'), scorer: (s: Record<string, number>) => (s.pts ?? 0) + (s.reb ?? 0) }
describe('NBA campus matchup cache reader', () => {
  it('scores a verified saved lineup from schedule-matched final boxes', async () => {
    const result = await nbaCampusPointsForMatchup(db(), input)
    expect(result).toEqual({ home: { points: 25, missingPlayerIds: [], allFinal: true }, away: { points: 0, missingPlayerIds: [], allFinal: true } })
  })
  it('withholds an empty lineup when no weekly snapshot exists', async () => {
    const database = db()
    const original = database.sportsDataCache.findMany
    database.sportsDataCache.findMany = vi.fn(async (args: any) => (await original(args)).filter((row: any) => row.cacheKey !== nbaCampusWeekCacheKey('l', 'away-af', 2026, 2)))
    const result = await nbaCampusPointsForMatchup(database, input)
    expect(result?.away).toMatchObject({ missingPlayerIds: ['campus-lineup:away'], allFinal: false })
  })
  it('scores a bye roster once even when it appears on both sides', async () => {
    const result = await nbaCampusPointsForMatchup(db(), { ...input, awayRosterId: 'home' })
    expect(result?.home).toEqual({ points: 25, missingPlayerIds: [], allFinal: true })
    expect(result?.away).toEqual(result?.home)
  })
  it('withholds finalization for missing boxes or a lineup recorded after game start', async () => {
    expect((await nbaCampusPointsForMatchup(db(snapshot(), null), input))?.home).toMatchObject({ missingPlayerIds: ['espn:ncaab:12'], allFinal: false })
    expect((await nbaCampusPointsForMatchup(db(snapshot('2026-11-01T19:00:00Z')), input))?.home).toMatchObject({ missingPlayerIds: ['espn:ncaab:12'], allFinal: false })
  })
})
