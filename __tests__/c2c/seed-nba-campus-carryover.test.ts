import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedNbaCampusCarryover } from '@/lib/c2c/seedNbaCampusCarryover'
import { currentNcaabRosterEvidence } from '@/lib/devy/ncaabRosterPool'
import { readRiScheduleWindow } from '@/lib/sports-data/riScheduleCache'
const now = new Date('2026-10-30T12:00:00Z')
vi.mock('@/lib/devy/ncaabRosterPool', () => ({ currentNcaabRosterEvidence: vi.fn(async () => ({ athletes: [{ id: 'espn:ncaab:12', espnId: '12', teamId: '10', name: 'A', school: 'School', position: 'G', jersey: null, observedAt: now }], ambiguous: [] })) }))
vi.mock('@/lib/sports-data/riScheduleCache', async load => ({ ...(await load<typeof import('@/lib/sports-data/riScheduleCache')>()), readRiScheduleWindow: vi.fn(async () => [{ gameId: '1', day: '2026-11-01', startTime: '2026-11-01T18:00:00Z', status: 'scheduled', homeTeamId: '1', awayTeamId: '2' }]) }))
function makeDb() {
  const roster = { id: 'r', leagueId: 'l', updatedAt: new Date('2026-10-26T00:00:00Z'), playerData: { lineup_sections: { devy: ['espn:ncaab:12'], campus: ['espn:ncaab:12'] } } }
  const meta = { data: { firstDay: '2026-11-01', lastDay: '2027-03-07', syncedAt: '2026-10-30T11:00:00Z' }, expiresAt: new Date('2027-01-01') }
  const tx = { $queryRaw: vi.fn().mockResolvedValue([{ id: 'r' }]), sportsDataCache: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) }, afRosterLineupAssignment: { count: vi.fn().mockResolvedValue(0), createMany: vi.fn().mockResolvedValue({ count: 1 }) } }
  const db = { redraftSeason: { findMany: vi.fn().mockResolvedValue([{ leagueId: 'l', season: 2026, currentWeek: 2, league: { platform: 'af', sport: 'NBA', leagueVariant: 'c2c' } }]) }, roster: { findMany: vi.fn().mockResolvedValue([roster]) }, sportsDataCache: { findUnique: vi.fn(async ({ where }: any) => where.cacheKey.endsWith('meta') ? meta : null) }, $transaction: vi.fn(async (f: any) => f(tx)) }
  return { db: db as any, tx }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now) })
afterEach(() => vi.useRealTimers())
describe('NBA campus carryover transaction', () => {
  it('writes the weekly snapshot and campus assignment together', async () => {
    const { db, tx } = makeDb()
    expect(await seedNbaCampusCarryover(db, { now, deadlineAt: Date.now() + 10000, maxRosters: 5 })).toMatchObject({ considered: 1, seeded: 1 })
    expect(tx.afRosterLineupAssignment.createMany).toHaveBeenCalledOnce()
    expect(tx.sportsDataCache.upsert).toHaveBeenCalledOnce()
  })
  it('recovers a missed snapshot from roster and school evidence recorded before the week', async () => {
    const { db, tx } = makeDb()
    vi.mocked(readRiScheduleWindow).mockResolvedValueOnce([{ gameId: '1', day: '2026-10-29', startTime: '2026-10-29T18:00:00Z', status: 'completed', seasonType: 'regular', eventName: null, replacedBy: null, homeTeamId: '1', awayTeamId: '2' }])
    vi.mocked(currentNcaabRosterEvidence).mockResolvedValueOnce({ athletes: [{ id: 'espn:ncaab:12', espnId: '12', teamId: '10', name: 'A', school: 'School', position: 'G', jersey: null, observedAt: new Date('2026-10-26T00:00:00Z') }], ambiguous: [] })
    expect(await seedNbaCampusCarryover(db, { now, deadlineAt: Date.now() + 10000, maxRosters: 5 })).toMatchObject({ seeded: 1 })
    const data = tx.sportsDataCache.upsert.mock.calls[0][0].create.data
    expect(data.players[0].selectedAt).toBe('2026-10-27T00:00:00.000Z')
  })
  it('does not write a stale roster or overwrite existing weekly assignments', async () => {
    const { db, tx } = makeDb()
    tx.$queryRaw.mockResolvedValueOnce([])
    expect(await seedNbaCampusCarryover(db, { now, deadlineAt: Date.now() + 10000, maxRosters: 5 })).toMatchObject({ seeded: 0, held: 1 })
    tx.afRosterLineupAssignment.count.mockResolvedValueOnce(1)
    expect(await seedNbaCampusCarryover(db, { now, deadlineAt: Date.now() + 10000, maxRosters: 5 })).toMatchObject({ seeded: 0, held: 1 })
    expect(tx.sportsDataCache.upsert).not.toHaveBeenCalled()
  })
})
