import { describe, expect, it, vi } from 'vitest'
import { prepareNbaCampusWeekSnapshot, persistNbaCampusWeekSnapshot, nbaCampusWeekCacheKey } from '@/lib/c2c/storeNbaCampusWeekSnapshot'
vi.mock('@/lib/devy/ncaabRosterPool', () => ({ currentNcaabRosterEvidence: vi.fn(async () => ({ athletes: [{ id: 'espn:ncaab:12', espnId: '12', teamId: '10', name: 'A', school: 'School', position: 'G', jersey: null, observedAt: new Date('2026-11-01T12:00:00Z') }], ambiguous: [] })) }))
describe('campus weekly school snapshot persistence', () => {
  it('prepares evidence and saves it under the league, roster and week key', async () => {
    const findUnique = vi.fn().mockResolvedValue(null), upsert = vi.fn().mockResolvedValue({})
    const db = { sportsDataCache: { findUnique, upsert } } as any
    const input = { leagueId: 'l', rosterId: 'r', season: 2026, week: 2, now: new Date('2026-11-01T12:00:00Z'), playerData: { lineup_sections: { devy: ['espn:ncaab:12'], campus: ['espn:ncaab:12'] } } }
    const result = await prepareNbaCampusWeekSnapshot(db, input)
    expect(result.snapshot?.players[0]).toMatchObject({ id: 'espn:ncaab:12', teamId: '10' })
    await persistNbaCampusWeekSnapshot(db, { leagueId: input.leagueId, rosterId: input.rosterId, now: input.now, snapshot: result.snapshot! })
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { cacheKey: nbaCampusWeekCacheKey('l', 'r', 2026, 2) } }))
  })
})
