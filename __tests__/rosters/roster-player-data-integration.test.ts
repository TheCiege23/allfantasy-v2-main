import { describe, expect, it, vi, beforeEach } from 'vitest'

/*
 * ⚠ THE ROSTER BRANCH READS `sportsPlayerRecord.findMany`, NOT `findUnique`.
 * The mock only defined `findUnique`, so the call threw "not a function" and the failure read as
 * broken behaviour rather than a missing stub. `sportsPlayer.findMany` is stubbed too: the media
 * loader runs after the records are fetched and would fail the same way.
 */
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn() },
    roster: { findFirst: vi.fn() },
    sportsPlayerRecord: { findUnique: vi.fn(), findMany: vi.fn() },
    sportsPlayer: { findMany: vi.fn() },
    fantasyPlayer: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { getPlayerDataForSurface } from '@/lib/player-data/getPlayerDataForSurface'

describe('Roster player data integration', () => {
  beforeEach(() => {
    vi.mocked(prisma.league.findUnique).mockResolvedValue({ sport: 'NFL' } as never)
    vi.mocked(prisma.roster.findFirst).mockResolvedValue({
      playerData: ['rec-1'],
    } as never)
    vi.mocked(prisma.sportsPlayer.findMany).mockResolvedValue([] as never)
    vi.mocked((prisma as unknown as { fantasyPlayer: { findMany: ReturnType<typeof vi.fn> } }).fantasyPlayer.findMany).mockResolvedValue([] as never)
    const record = {
      id: 'rec-1',
      sport: 'NFL',
      name: 'Starter Athlete',
      team: 'KC',
      position: 'WR',
      stats: { rec: 40 },
      projections: { pts: 12 },
      dataSource: 'rolling_insights',
      headshotSource: 'cdn',
      injuryStatus: null,
      adp: null,
      headshotUrl: 'https://example.com/h.png',
    }
    vi.mocked(prisma.sportsPlayerRecord.findUnique).mockResolvedValue(record as never)
    vi.mocked(prisma.sportsPlayerRecord.findMany).mockResolvedValue([record] as never)
  })

  it('hydrates roster ids through sports_players projection cache', async () => {
    const rows = await getPlayerDataForSurface({
      surface: 'roster',
      leagueId: 'lg',
      userId: 'user-1',
      limit: 10,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.unified.profileSource).toBe('rolling_insights')
    expect(rows[0]?.unified.normalizedStats.cacheStats).toEqual({ rec: 40 })
  })
})
