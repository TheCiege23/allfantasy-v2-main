import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn() },
    roster: { findMany: vi.fn() },
    sportsPlayerRecord: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}))

vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({
  getPlayerPoolForLeague: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { getPlayerPoolForLeague } from '@/lib/sport-teams/SportPlayerPoolResolver'
import { getPlayerDataForSurface } from '@/lib/player-data/getPlayerDataForSurface'

describe('Waiver player data integration', () => {
  beforeEach(() => {
    vi.mocked(prisma.league.findUnique).mockResolvedValue({ sport: 'NFL' } as never)
    vi.mocked(prisma.roster.findMany).mockResolvedValue([{ playerData: [] }] as never)
    vi.mocked(prisma.sportsPlayerRecord.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.sportsPlayerRecord.findMany).mockResolvedValue([])
    vi.mocked(getPlayerPoolForLeague).mockResolvedValue([
      {
        player_id: 'w1',
        sport_type: 'NFL',
        team_id: null,
        team_abbreviation: 'CAR',
        team: 'CAR',
        full_name: 'Waiver Target',
        position: 'RB',
        status: null,
        injury_status: 'Questionable',
        external_source_id: '111',
      },
    ] as never)
  })

  it('lists waiver-eligible pool rows with unified identity + injury', async () => {
    const rows = await getPlayerDataForSurface({ surface: 'waivers', leagueId: 'lg', limit: 5 })
    expect(rows[0]?.unified.fullName).toBe('Waiver Target')
    expect(rows[0]?.unified.injuryStatus).toContain('Questionable')
  })
})
