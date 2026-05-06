import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn() },
    roster: { findFirst: vi.fn() },
    sportsPlayerRecord: { findUnique: vi.fn() },
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
    vi.mocked(prisma.sportsPlayerRecord.findUnique).mockResolvedValue({
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
    } as never)
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
