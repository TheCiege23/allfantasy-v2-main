import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(), findFirst: vi.fn() },
    roster: { findMany: vi.fn(), findFirst: vi.fn() },
    sportsPlayerRecord: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
  },
}))

vi.mock('@/lib/draft-room/getResolvedDraftPoolForLeague', () => ({
  getResolvedDraftPoolForLeague: vi.fn(),
}))

vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({
  getPlayerPoolForLeague: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { getResolvedDraftPoolForLeague } from '@/lib/draft-room/getResolvedDraftPoolForLeague'
import { getPlayerPoolForLeague } from '@/lib/sport-teams/SportPlayerPoolResolver'
import { getPlayerDataForSurface } from '@/lib/player-data/getPlayerDataForSurface'
import { normalizeDraftPlayer } from '@/lib/draft-sports-models/normalize-draft-player'

describe('getPlayerDataForSurface', () => {
  beforeEach(() => {
    vi.mocked(prisma.league.findUnique).mockReset()
    vi.mocked(prisma.roster.findMany).mockReset()
    vi.mocked(prisma.roster.findFirst).mockReset()
    vi.mocked(prisma.sportsPlayerRecord.findFirst).mockReset()
    vi.mocked(prisma.sportsPlayerRecord.findUnique).mockReset()
    vi.mocked(prisma.sportsPlayerRecord.findMany).mockReset()
    vi.mocked(getResolvedDraftPoolForLeague).mockReset()
    vi.mocked(getPlayerPoolForLeague).mockReset()
  })

  it('draft surface maps resolved pool entries through unified meta', async () => {
    const entry = normalizeDraftPlayer(
      { full_name: 'Draftable', position: 'TE', team: 'SF', playerId: 'te-9', yearsExp: 1 },
      'NFL',
    )
    vi.mocked(getResolvedDraftPoolForLeague).mockResolvedValue({
      entries: [entry],
      sport: 'NFL',
      count: 1,
      rosterConfigurationIncomplete: false,
    })

    const rows = await getPlayerDataForSurface({
      surface: 'draft',
      leagueId: 'league-1',
      limit: 5,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.unified.fullName).toBe('Draftable')
    expect(rows[0]!.unified.nflRookie?.isRookie).toBe(false)
  })

  it('waivers surface hydrates from pool + optional sports_players row', async () => {
    vi.mocked(prisma.league.findUnique).mockResolvedValue({ sport: 'NFL' } as never)
    vi.mocked(prisma.roster.findMany).mockResolvedValue([{ playerData: [] }] as never)
    vi.mocked(prisma.sportsPlayerRecord.findMany).mockResolvedValue([
      {
        id: 'fa-1',
        stats: { rush_yards: 12 },
        projections: { half_ppr: 8 },
        dataSource: 'rolling_insights',
        headshotSource: 'cdn',
        adp: 44,
      },
    ] as never)

    vi.mocked(getPlayerPoolForLeague).mockResolvedValue([
      {
        player_id: 'fa-1',
        sport_type: 'NFL',
        team_id: null,
        team_abbreviation: 'NYG',
        team: 'NYG',
        full_name: 'Wire Add',
        position: 'WR',
        status: null,
        injury_status: null,
        external_source_id: '999',
      },
    ] as never)

    const rows = await getPlayerDataForSurface({
      surface: 'waivers',
      leagueId: 'league-w',
      limit: 10,
    })

    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[0]!.unified.fullName).toBe('Wire Add')
    expect(rows[0]!.unified.normalizedStats.cacheStats).toEqual({ rush_yards: 12 })
  })
})
