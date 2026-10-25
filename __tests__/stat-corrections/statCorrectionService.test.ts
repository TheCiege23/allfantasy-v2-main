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
const applyAdj = vi.hoisted(() => vi.fn())
vi.mock('@/lib/score-adjustments/scoreAdjustmentService', () => ({ applyStatCorrectionAdjustment: applyAdj }))

import { applyStatCorrections, readStatCorrections, statCorrectionReason } from '@/lib/stat-corrections/statCorrectionService'

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
  m.prisma.league.findUnique.mockResolvedValue({ sport: 'NFL', platform: 'allfantasy', settings: {} })
  applyAdj.mockResolvedValue({ ok: true, adjustment: { id: 'a' }, net: 0 })
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
    expect(view.latest?.matchups[0]).toMatchObject({ home: { correction: -4.5, applied: 0 }, away: { correction: 0, applied: 0 }, fullyApplied: false })
  })

  it('counts only stat-correction adjustments as applied, and marks a matchup done when both teams are', async () => {
    const adj = (points: number, source?: string) => ({ id: String(points), matchupId: 'm', rosterId: 'A', week: 7, points, reason: 'x', byUserId: 'c', at: 'now', ...(source ? { source } : {}) })
    m.prisma.league.findUnique.mockResolvedValue({ sport: 'NFL', platform: 'allfantasy', settings: { commissioner_score_adjustments: [adj(-5), adj(-4.5, 'stat_correction')] } })
    const view = await readStatCorrections('L')
    expect(view.latest?.matchups[0].home.applied).toBe(-4.5)
    expect(view.latest?.matchups[0].fullyApplied).toBe(true)
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

describe('applyStatCorrections', () => {
  it("brings each team in the matchup to its correction, with the players in the reason", async () => {
    expect(await applyStatCorrections('L', 'commish', 'm')).toEqual({ ok: true, week: 7, adjustmentsAdded: 2 })
    expect(applyAdj).toHaveBeenNthCalledWith(1, 'L', 'commish', { matchupId: 'm', rosterId: 'A', targetNet: -4.5, reason: 'Stat correction, week 7: P −4.5' })
    expect(applyAdj).toHaveBeenNthCalledWith(2, 'L', 'commish', { matchupId: 'm', rosterId: 'B', targetNet: 0, reason: 'Stat correction, week 7' })
  })

  it("'all' covers every matchup in the review; already-applied teams count as nothing added", async () => {
    applyAdj.mockResolvedValue({ ok: true, adjustment: null, net: -4.5 })
    expect(await applyStatCorrections('L', 'commish', 'all')).toEqual({ ok: true, week: 7, adjustmentsAdded: 0 })
    expect(applyAdj).toHaveBeenCalledTimes(2)
  })

  it('refuses a matchup the review does not list, and stops at the first refusal', async () => {
    expect(await applyStatCorrections('L', 'commish', 'other')).toEqual({ ok: false, error: 'not_in_review' })
    expect(applyAdj).not.toHaveBeenCalled()
    applyAdj.mockResolvedValueOnce({ ok: false, error: 'not_points' })
    expect(await applyStatCorrections('L', 'commish', 'm')).toEqual({ ok: false, error: 'not_points' })
    expect(applyAdj).toHaveBeenCalledTimes(1)
  })

  it('refuses a league the review does not cover, and one with no review', async () => {
    m.prisma.league.findUnique.mockResolvedValue({ sport: 'NFL', platform: 'sleeper', settings: {} })
    expect(await applyStatCorrections('L', 'commish', 'all')).toEqual({ ok: false, error: 'not_covered' })
    m.prisma.league.findUnique.mockResolvedValue({ sport: 'NFL', platform: 'allfantasy', settings: {} })
    m.prisma.sportsDataCache.findMany.mockResolvedValue([])
    expect(await applyStatCorrections('L', 'commish', 'all')).toEqual({ ok: false, error: 'no_review' })
    expect(applyAdj).not.toHaveBeenCalled()
  })

  it('writes the reason with signed points', () => {
    expect(statCorrectionReason(3, [{ rosterId: 'A', playerId: 'p', playerName: 'Ann', position: 'WR', before: 1, after: 3.2, delta: 2.2 }])).toBe('Stat correction, week 3: Ann +2.2')
  })
})
