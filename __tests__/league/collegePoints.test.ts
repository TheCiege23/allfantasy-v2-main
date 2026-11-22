import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  identities: [] as Array<{ id: string; rollingInsightsId: string }>,
  riRows: [] as Array<{ playerId: string; normalizedStatMap: unknown }>,
  cfbdRows: [] as Array<{ playerId: string; normalizedStatMap: unknown }>,
  riAny: null as unknown,
  cfbdAny: null as unknown,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: { findMany: vi.fn(async () => h.identities) },
    playerGameStat: {
      findMany: vi.fn(async (q: { where: { source?: string } }) => (q.where.source === 'rolling_insights_live' ? h.riRows : h.cfbdRows)),
      findFirst: vi.fn(async (q: { where: { source?: string } }) => (q.where.source === 'rolling_insights_live' ? h.riAny : h.cfbdAny)),
    },
  },
}))
vi.mock('@/lib/c2c/campusWeeks', () => ({
  loadCfbWeeksForNflWeek: vi.fn(async () => [12]),
  loadNflWeekWindow: vi.fn(async () => ({ start: Date.UTC(2026, 10, 17, 9), end: Date.UTC(2026, 10, 24, 9) })),
}))
// Each stored row here carries its own points, so the test is about WHICH rows are used, not scoring.
vi.mock('@/lib/scoring-runtime/ncaafStatNormalization', () => ({
  aggregateNcaafWeek: (rows: Array<{ pts?: number }>) => {
    const scored = rows.filter((r) => typeof r?.pts === 'number')
    return { stats: { pts: scored.reduce((n, r) => n + r.pts!, 0) }, gamesCounted: scored.length, unmappedKeys: [] }
  },
}))
vi.mock('@/lib/redraft/scoringEngine', () => ({ buildLeagueStatScorer: () => (stats: { pts: number }) => stats.pts }))

import { loadCollegePoints } from '@/lib/league/collegePro/collegePoints'

const players = [
  { id: 'fx-qb', cfbdId: 'c-qb', rollingInsightsId: 'ri-qb', position: 'QB' },
  { id: 'fx-wr', cfbdId: 'c-wr', rollingInsightsId: 'ri-wr', position: 'WR' },
  { id: 'fx-te', cfbdId: null, rollingInsightsId: null, position: 'TE' },
]

beforeEach(() => {
  h.identities = [
    { id: 'id-qb', rollingInsightsId: 'ri-qb' },
    { id: 'id-wr', rollingInsightsId: 'ri-wr' },
  ]
  h.riRows = []
  h.cfbdRows = []
  h.riAny = null
  h.cfbdAny = null
})

describe('loadCollegePoints', () => {
  it('uses the live RI line when there is one, never adding the CFBD line for the same game', async () => {
    h.riRows = [{ playerId: 'id-qb', normalizedStatMap: { pts: 21 } }]
    h.cfbdRows = [{ playerId: 'c-qb', normalizedStatMap: { pts: 20 } }, { playerId: 'c-wr', normalizedStatMap: { pts: 9 } }]
    h.riAny = { id: 'x' }
    h.cfbdAny = { id: 'y' }
    const r = await loadCollegePoints({ season: 2026, nflWeek: 12, players })
    expect(r.points).toEqual({ 'fx-qb': 21, 'fx-wr': 9 })
    expect(r.live).toBe(true)
    expect(r.statsOnFile).toBe(true)
  })

  it('falls back to CFBD when an RI line cannot be scored', async () => {
    h.riRows = [{ playerId: 'id-qb', normalizedStatMap: { unreadable: true } }]
    h.cfbdRows = [{ playerId: 'c-qb', normalizedStatMap: { pts: 20 } }]
    h.riAny = { id: 'x' }
    const r = await loadCollegePoints({ season: 2026, nflWeek: 12, players })
    expect(r.points).toEqual({ 'fx-qb': 20 })
    expect(r.live).toBe(false)
  })

  it('a player with no line this week is absent, not 0, and an empty week says no stats yet', async () => {
    const r = await loadCollegePoints({ season: 2026, nflWeek: 12, players })
    expect(r.points).toEqual({})
    expect(r.statsOnFile).toBe(false)
  })
  it("reports the college league's own scoring when its Fantrax rules are passed, and the defaults otherwise", async () => {
    h.riRows = [{ playerId: 'id-qb', normalizedStatMap: { pts: 21 } }]
    h.riAny = { id: 'x' }
    const own = await loadCollegePoints({ season: 2026, nflWeek: 12, players, settings: { scoringSettings: { source: 'fantrax', rules: { pass_td: 6 } } } })
    expect(own.scoredWith).toBe('league')
    const std = await loadCollegePoints({ season: 2026, nflWeek: 12, players })
    expect(std.scoredWith).toBe('standard')
  })
})
