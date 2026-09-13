import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  leagueFindMany: vi.fn(),
  cacheFind: vi.fn(),
  cacheUpsert: vi.fn(),
  groupBy: vi.fn(),
  ingest: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: h.leagueFindMany },
    sportsDataCache: { findUnique: h.cacheFind, upsert: h.cacheUpsert },
    weeklyMatchup: { groupBy: h.groupBy },
  },
}))
vi.mock('@/lib/sleeper/sync/ingestSleeperPlayerScores', () => ({ ingestSleeperPlayerScoresForWeek: h.ingest }))
vi.mock('@/lib/live/playByPlayFeed', () => ({ inProgressRiGameIds: vi.fn(async () => []) }))

import {
  LIVE_POINTS_LEAGUES_PER_PASS,
  nflSeasonFor,
  refreshLiveSleeperPoints,
} from '@/lib/live/liveSleeperPointsSync'
import { sleeperScoreTargetWeeks } from '@/lib/sleeper/sync/sleeperScoreTargetWeeks'

const NOW = new Date('2026-09-13T18:00:00Z')
const live = { liveGameIds: async () => ['20260913-1-26'], clock: () => 0 }
const leagues = (n: number) => Array.from({ length: n }, (_, i) => ({ platformLeagueId: `L${String(i).padStart(2, '0')}` }))

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.cacheFind.mockResolvedValue(null)
  h.cacheUpsert.mockResolvedValue({})
  // Week 1 played, week 2 the frontier.
  h.groupBy.mockResolvedValue([
    { week: 1, _sum: { pointsFor: 210 } },
    { week: 2, _sum: { pointsFor: 0 } },
  ])
  h.ingest.mockResolvedValue({ scoresUpserted: 5, error: null })
})

describe('refreshLiveSleeperPoints', () => {
  it('does nothing while no NFL game is in progress', async () => {
    const res = await refreshLiveSleeperPoints(NOW, { liveGameIds: async () => [], clock: () => 0 })
    expect(res.skipped).toBe('no-live-games')
    expect(h.leagueFindMany).not.toHaveBeenCalled()
    expect(h.ingest).not.toHaveBeenCalled()
  })

  it("asks only for this season's claimed Sleeper NFL leagues", async () => {
    h.leagueFindMany.mockResolvedValue(leagues(1))
    await refreshLiveSleeperPoints(NOW, live)
    const where = h.leagueFindMany.mock.calls[0][0].where
    expect(where.platform).toEqual({ equals: 'sleeper', mode: 'insensitive' })
    expect(where.sport).toBe('NFL')
    expect(where.season).toBe(2026)
    expect(where.teams).toEqual({ some: { claimedByUserId: { not: null } } })
  })

  it("refreshes each league's frontier week and the week before, through the platform's own scoring", async () => {
    h.leagueFindMany.mockResolvedValue(leagues(2))
    const res = await refreshLiveSleeperPoints(NOW, live)
    expect(h.ingest.mock.calls.map((c) => c.join('|')).sort()).toEqual(
      ['L00|2026|1', 'L00|2026|2', 'L01|2026|1', 'L01|2026|2'],
    )
    expect(res).toMatchObject({ leaguesConsidered: 2, leaguesSynced: 2, scoresUpserted: 20, errors: 0, skipped: null })
  })

  it('one failing league is counted and the rest still refresh', async () => {
    h.leagueFindMany.mockResolvedValue(leagues(3))
    h.ingest.mockImplementation(async (leagueId: string) =>
      leagueId === 'L01' ? { scoresUpserted: 0, error: 'sleeper 503' } : { scoresUpserted: 1, error: null },
    )
    const res = await refreshLiveSleeperPoints(NOW, live)
    expect(res).toMatchObject({ leaguesSynced: 2, errors: 1 })
  })

  it('rotates through a large league set instead of refreshing the same slice every pass', async () => {
    h.leagueFindMany.mockResolvedValue(leagues(45))
    h.cacheFind.mockResolvedValue({ data: { offset: 40 }, expiresAt: new Date(Date.now() + 60_000) })
    await refreshLiveSleeperPoints(NOW, live)
    const touched = new Set(h.ingest.mock.calls.map((c) => c[0]))
    expect(touched.size).toBe(LIVE_POINTS_LEAGUES_PER_PASS)
    // Starts where the last pass stopped and wraps around.
    expect(touched.has('L40')).toBe(true)
    expect(touched.has('L44')).toBe(true)
    expect(touched.has('L00')).toBe(true)
    expect(touched.has('L39')).toBe(false)
    expect(h.cacheUpsert.mock.calls[0][0].update.data).toEqual({ offset: (40 + 40) % 45 })
  })

  it('stops at its time budget and resumes from the first league it did not reach', async () => {
    h.leagueFindMany.mockResolvedValue(leagues(5))
    // The first read sets the deadline; every later read is past it.
    let calls = 0
    const res = await refreshLiveSleeperPoints(NOW, { liveGameIds: live.liveGameIds, clock: () => (calls++ === 0 ? 0 : 60_000) })
    expect(h.ingest).not.toHaveBeenCalled()
    expect(res.leaguesSynced).toBe(0)
    expect(h.cacheUpsert.mock.calls[0][0].update.data).toEqual({ offset: 0 })
  })
})

describe('nflSeasonFor', () => {
  it('puts January and February games in the previous season', () => {
    expect(nflSeasonFor(new Date('2026-09-13T00:00:00Z'))).toBe(2026)
    expect(nflSeasonFor(new Date('2027-01-17T00:00:00Z'))).toBe(2026)
    expect(nflSeasonFor(new Date('2027-03-01T00:00:00Z'))).toBe(2027)
  })
})

describe('sleeperScoreTargetWeeks', () => {
  it('targets the frontier and the week before it', async () => {
    await expect(sleeperScoreTargetWeeks('L1', 2026)).resolves.toEqual([2, 1])
    expect(h.groupBy.mock.calls[0][0].where).toEqual({ leagueId: 'L1', seasonYear: 2026 })
  })

  it('with every week scored, the newest week', async () => {
    h.groupBy.mockResolvedValue([
      { week: 1, _sum: { pointsFor: 210 } },
      { week: 2, _sum: { pointsFor: 199 } },
    ])
    await expect(sleeperScoreTargetWeeks('L1', 2026)).resolves.toEqual([2])
  })

  it('week 1 as the frontier has no week before it', async () => {
    h.groupBy.mockResolvedValue([{ week: 1, _sum: { pointsFor: 0 } }])
    await expect(sleeperScoreTargetWeeks('L1', 2026)).resolves.toEqual([1])
  })
})
