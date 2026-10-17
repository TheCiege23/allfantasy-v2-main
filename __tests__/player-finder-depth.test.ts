import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The deeper card's loader (lib/core-app/playerDepth.ts), against a mocked database boundary.
 * No provider is reached: market values and odds are mocked readers.
 */

const mockProjFindMany = vi.hoisted(() => vi.fn())
const mockStatFindMany = vi.hoisted(() => vi.fn())
const mockLeagueFindMany = vi.hoisted(() => vi.fn())
const mockLeagueFindUnique = vi.hoisted(() => vi.fn())
const mockOdds = vi.hoisted(() => vi.fn())
const mockGetMarketValues = vi.hoisted(() => vi.fn())

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    fantasyProjection: { findMany: mockProjFindMany },
    playerGameStat: { findMany: mockStatFindMany },
    league: { findMany: mockLeagueFindMany, findUnique: mockLeagueFindUnique },
  },
}))
vi.mock('@/lib/core-app/playerCard', async () => {
  const { mergeNewsItems } = await vi.importActual<typeof import('@/lib/core-app/playerCard')>('@/lib/core-app/playerCard')
  return {
    mergeNewsItems,
    loadNews: vi.fn(async () => ({ available: true, data: [{ title: 'Daniels ruled out', source: 'espn', url: 'https://x/1', publishedAt: '2026-09-27T15:32:00.000Z' }] })),
    loadPlayerBlurbs: vi.fn(async () => [{ title: 'Knee sprain, did not practice Friday.', source: 'rolling_insights', url: null, publishedAt: '2026-09-26T20:00:00.000Z' }]),
    loadSchedule: vi.fn(async () => ({ schedule: { available: true, data: { weeks: [{ week: 3, opponent: 'GB', home: true, bye: false, projection: null }, { week: 4, opponent: null, home: false, bye: true, projection: null }], season: 2026, projectedWeek: null } }, byeWeek: 4 })),
  }
})
vi.mock('@/lib/odds/gameOddsReads', () => ({ readWeekMarketContextByTeam: mockOdds }))
vi.mock('@/lib/trade-intel/marketValueService', () => ({
  getMarketValues: mockGetMarketValues,
  playerValueForLeague: (values: { bySleeperId: Record<string, { value: number }>; tep?: boolean }, id: string, scoring: Record<string, unknown> | null) => {
    const base = values.bySleeperId[id]?.value
    if (base == null) return null
    // A tight-end premium league moves his value; nothing else does.
    return scoring && scoring.bonus_rec_te ? { base, adjusted: Math.round(base * 1.2), fit: { reason: 'TE premium' } } : { base, adjusted: base, fit: null }
  },
}))

import { clearPlayerDepthCache, getPlayerDepth } from '@/lib/core-app/playerDepth'
import type { PlayerDetail } from '@/lib/core-app/playerFinder'

const detail = (over: Partial<PlayerDetail> = {}) =>
  ({
    player: { sport: 'NFL', externalId: 'x-9509', sleeperId: '9509', name: 'Jayden Daniels', team: 'WAS', position: 'QB', imageUrl: null },
    injury: { available: true, data: { status: 'Out', description: 'Knee', reportedAt: null } },
    scheduleWeek: { season: 2026, week: 3 },
    game: { available: true, data: { kickoff: '2026-09-27T17:00:00.000Z', opponent: 'GB', home: true, week: 3, season: 2026, preseason: false } },
    leagues: { available: true, data: [{ leagueId: 'L1' }, { leagueId: 'L2' }, { leagueId: 'L3' }] },
    ...over,
  }) as unknown as PlayerDetail

beforeEach(() => {
  vi.clearAllMocks()
  clearPlayerDepthCache()
  mockProjFindMany.mockResolvedValue([
    { week: 1, projectedPoints: 21.53, stats: { stats: { pass_yd: 250, pass_td: 2 } } },
    { week: 2, projectedPoints: 21.96, stats: { stats: { pass_yd: 240, pass_td: 1 } } },
  ])
  mockStatFindMany.mockResolvedValue([
    { weekOrRound: 1, opponent: 'PIT', normalizedStatMap: { gp: 1, pts_ppr: 31.3, pass_yd: 300, pass_td: 3 } },
    { weekOrRound: 2, opponent: 'CAR', normalizedStatMap: { gp: 1, pts_ppr: 11.1, pass_yd: 150, pass_td: 0 } },
  ])
  mockOdds.mockResolvedValue(new Map([['WAS', { team: 'WAS', opponent: 'GB', isHome: true, impliedTeamTotal: 24.5, spread: -3.5, gameTotal: 47.5, winProbability: 0.62, isStale: false }]]))
  mockGetMarketValues.mockResolvedValue({ mode: 'redraft', numQbs: 1, bySleeperId: { '9509': { value: 5000 } } })
  mockLeagueFindMany.mockResolvedValue([
    { id: 'L1', leagueType: 'redraft', settings: { leagueSize: 12, scoring_settings: { rec: 1 } } },
    { id: 'L2', leagueType: 'redraft', settings: { leagueSize: 12, scoring_settings: { rec: 1 } } },
    { id: 'L3', leagueType: 'redraft', settings: { leagueSize: 12, scoring_settings: { rec: 1, bonus_rec_te: 0.5 } } },
  ])
})

describe('getPlayerDepth', () => {
  it('compares PPR with PPR by default, week by week', async () => {
    const d = await getPlayerDepth(detail())
    if (!d.season.available) throw new Error(d.season.reason)
    expect(d.season.data.scoring).toEqual({ kind: 'ppr' })
    expect(d.season.data.weeks).toEqual([
      { week: 1, opponent: 'PIT', projected: 21.5, actual: 31.3, played: true },
      { week: 2, opponent: 'CAR', projected: 22, actual: 11.1, played: true },
    ])
    // The projection feed read is the provider feed, never the AF mirror rows.
    expect(mockProjFindMany.mock.calls[0][0].where).toMatchObject({ playerId: '9509', season: '2026', source: { not: 'allfantasy' } })
  })

  it("re-scores BOTH sides under the held league's scoring", async () => {
    mockLeagueFindUnique.mockResolvedValue({ name: 'KBFL', settings: { scoring_settings: { pass_yd: 0.04, pass_td: 6 } } })
    const d = await getPlayerDepth(detail(), { heldLeagueId: 'L1' })
    if (!d.season.available) throw new Error(d.season.reason)
    expect(d.season.data.scoring).toEqual({ kind: 'league', leagueName: 'KBFL' })
    // wk1: proj 250*0.04 + 2*6 = 22; scored 300*0.04 + 3*6 = 30
    expect(d.season.data.weeks[0]).toMatchObject({ projected: 22, actual: 30 })
  })

  it("carries the market's read of his team's game and the next weeks with the bye", async () => {
    const d = await getPlayerDepth(detail())
    expect(d.nextGame).toMatchObject({ available: true, data: { opponent: 'GB', home: true, market: { impliedTeamTotal: 24.5, spread: -3.5, winProbability: 0.62 } } })
    expect(d.upcoming.available && d.upcoming.data.weeks.map((w) => w.bye)).toEqual([false, true])
  })

  it('merges the news with the injury sentences, newest first, without repeating the designation note', async () => {
    const d = await getPlayerDepth(detail())
    if (!d.news.available) throw new Error(d.news.reason)
    expect(d.news.data.map((n) => n.title)).toEqual(['Daniels ruled out', 'Knee sprain, did not practice Friday.'])
  })

  it('prices each league once per format, with the league’s scoring fit, and says when it moved', async () => {
    const d = await getPlayerDepth(detail())
    expect(d.leagueValues).toEqual({
      L1: { value: 5000, base: 5000, fitNote: null, mode: 'redraft', numQbs: 1 },
      L2: { value: 5000, base: 5000, fitNote: null, mode: 'redraft', numQbs: 1 },
      L3: { value: 6000, base: 5000, fitNote: 'TE premium', mode: 'redraft', numQbs: 1 },
    })
    // L1 and L2 share a format: one value-set read for both.
    expect(mockGetMarketValues.mock.calls.length).toBeLessThan(3)
  })

  it('carries the chart’s FAAB anchor with each league value when there is one — what the free-agent bid needs', async () => {
    mockGetMarketValues.mockResolvedValue({ mode: 'redraft', numQbs: 1, bySleeperId: { '9509': { value: 5000 } }, faab: { anchorRank: 150, anchorValue: 3000, formula: 'x' } })
    const d = await getPlayerDepth(detail())
    expect(d.leagueValues?.L1).toMatchObject({ value: 5000, faabAnchor: 3000 })
  })

  it('computes no per-league value for a viewer without AF Pro', async () => {
    const d = await getPlayerDepth(detail(), { includeValues: false })
    expect(d.leagueValues).toBeNull()
    expect(mockGetMarketValues).not.toHaveBeenCalled()
    expect(mockLeagueFindMany).not.toHaveBeenCalled()
  })

  it('reads the per-player part once a minute for everyone', async () => {
    await getPlayerDepth(detail())
    await getPlayerDepth(detail())
    expect(mockProjFindMany).toHaveBeenCalledTimes(1)
    expect(mockOdds).toHaveBeenCalledTimes(1)
  })
})
