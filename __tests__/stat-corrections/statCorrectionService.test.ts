import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findUnique: vi.fn() },
    redraftSeason: { findFirst: vi.fn() },
    sportsDataCache: { findMany: vi.fn() },
    redraftRoster: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))

import { readStatCorrections } from '@/lib/stat-corrections/statCorrectionService'

const stored = (week: number, leagueId = 'L') => ({
  data: {
    seasonId: 'S',
    leagueId,
    season: 2026,
    week,
    sealedAt: '2026-10-20T12:00:00.000Z',
    checkedAt: '2026-10-22T12:00:00.000Z',
    review: {
      changes: [{ rosterId: 'A', playerId: 'p', playerName: 'P', position: 'RB', before: 13, after: 8.5, delta: -4.5 }],
      matchups: [{ matchupId: 'm', home: { rosterId: 'A', before: 100, after: 95.5 }, away: { rosterId: 'B', before: 99, after: 99 }, resultFlipped: true }],
      unchecked: 1,
      fingerprint: 'f',
    },
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  m.prisma.league.findUnique.mockResolvedValue({ sport: 'NFL', platform: 'allfantasy' })
  m.prisma.redraftSeason.findFirst.mockResolvedValue({ id: 'S' })
  m.prisma.sportsDataCache.findMany.mockResolvedValue([stored(6), stored(7)])
  m.prisma.redraftRoster.findMany.mockResolvedValue([{ id: 'A', teamName: 'Taco Tuesday', ownerName: 'Sam' }, { id: 'B', teamName: null, ownerName: 'Jo' }])
})

describe('readStatCorrections', () => {
  it('returns the latest week for the season with team names', async () => {
    const view = await readStatCorrections('L')
    expect(m.prisma.sportsDataCache.findMany.mock.calls[0][0].where).toEqual({ cacheKey: { startsWith: 'stat-correction-review:S:' } })
    expect(view.covered).toBe(true)
    expect(view.latest).toMatchObject({ week: 7, unchecked: 1, windowClosesAt: '2026-10-26T12:00:00.000Z' })
    expect(view.latest?.changes[0].teamName).toBe('Taco Tuesday')
    expect(view.latest?.matchups[0].away.teamName).toBe('Jo')
  })

  it('ignores a stored review that belongs to another league', async () => {
    m.prisma.sportsDataCache.findMany.mockResolvedValue([stored(8, 'OTHER')])
    expect((await readStatCorrections('L')).latest).toBeNull()
  })

  it('says an imported or non-NFL league is not covered, without reading reviews', async () => {
    m.prisma.league.findUnique.mockResolvedValue({ sport: 'NFL', platform: 'sleeper' })
    expect(await readStatCorrections('L')).toEqual({ covered: false, latest: null })
    m.prisma.league.findUnique.mockResolvedValue({ sport: 'NBA', platform: 'allfantasy' })
    expect(await readStatCorrections('L')).toEqual({ covered: false, latest: null })
    expect(m.prisma.sportsDataCache.findMany).not.toHaveBeenCalled()
  })
})
