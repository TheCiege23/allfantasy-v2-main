import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GradedTrade, TradeGradesPayload, TradeSideGrade } from '@/lib/trade-intel/sleeperTradeGradeService'

/*
 * The /core Trades history was the slowest section on the screen (19–30s cold). Three fixes, each
 * pinned here so it cannot quietly come undone:
 *   1. grading runs as a POOL across the whole history, not fifteen batches of four that each wait
 *      for their slowest trade — same values, same order;
 *   2. the league-scoped inputs to each projection (context, charts, stat board, live rosters) are
 *      read once per history, not once per trade — same values;
 *   3. a second load of the same ledger reuses the graded history instead of grading it again.
 */

const mocks = vi.hoisted(() => ({
  grades: vi.fn(),
  feed: vi.fn(),
  oneGrade: vi.fn(),
  expectation: vi.fn(),
  save: vi.fn(),
  cache: new Map<string, { data: unknown; expiresAt: Date }>(),
}))

vi.mock('@/lib/trade-intel/sleeperTradeGradeService', () => ({ getTradeGrades: mocks.grades }))
vi.mock('@/lib/trade-intel/sleeperTradeSync', () => ({ currentTradeIds: mocks.feed }))
vi.mock('@/lib/import-os/collector/archiveFeedTrades', () => ({ archiveCompletedFeedTrades: async () => ({ written: 0, trades: 0 }) }))
vi.mock('@/lib/trade-intel/tradeExpectationLoader', () => ({
  loadTradeExpectation: mocks.expectation,
  tradeExpectationShared: () => ({ memo: new Map() }),
}))
vi.mock('@/lib/decision-os/trade/completedTradeGrade', () => ({ oneGradeForCompletedTrade: mocks.oneGrade }))
vi.mock('@/lib/decision-os/trade/frozenCompletedGrade', () => ({
  loadFrozenCompletedGrades: async () => new Map(),
  saveFrozenCompletedGrades: mocks.save,
}))
vi.mock('@/lib/player-media', () => ({ attachPlayerMediaBatch: async () => new Map() }))
/* An in-memory `sportsDataCache`, so the REAL cache module is what these tests exercise. */
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: {
      findUnique: async ({ where }: { where: { cacheKey: string } }) => mocks.cache.get(where.cacheKey) ?? null,
      upsert: async ({ where, create }: { where: { cacheKey: string }; create: { data: unknown; expiresAt: Date } }) => {
        mocks.cache.set(where.cacheKey, { data: create.data, expiresAt: create.expiresAt })
        return null
      },
    },
  },
}))

import { getSleeperTradeHistory, gradeHistoryTrades, HISTORY_GRADE_CONCURRENCY } from '@/lib/core-app/sleeperTradeHistory'

const side = (rosterId: number, scored: boolean): TradeSideGrade => ({
  rosterId, ownerId: `owner-${rosterId}`, managerName: `Manager ${rosterId}`, teamName: null, avatar: null,
  // A scored side has realized points credited; an unscored trade "has no signal" and needs the projection.
  playersIn: scored
    ? [{ playerId: `p${rosterId}`, name: `Player ${rosterId}`, position: 'WR', pointsBySeason: {}, creditedBySeason: { '2025': 12 }, departed: null, gamesMissedBySeason: {} } as never]
    : [],
  playersOut: [], picksIn: [], picksOut: [], madePlayoffs: null,
  seasonNets: scored ? [{ season: '2025', net: 12, games: 4 } as never] : [], cumulativeNet: scored ? 12 : 0,
  initialGrade: 'C', currentGrade: 'C', trend: 'steady',
})
const trade = (n: number, scored = n % 2 === 0): GradedTrade => ({
  id: `league:tx${n}`, season: '2026', week: 1 + (n % 17),
  createdIso: new Date(Date.UTC(2026, 8, 1) + n * 3_600_000).toISOString(),
  multiTeam: false, tie: false, hasPendingPicks: false,
  sides: [side(1, scored), side(2, scored)],
})
const payload = (trades: GradedTrade[], fetchedAt = '2026-11-06T00:00:00.000Z'): TradeGradesPayload => ({
  version: 2, fetchedAt, staleAsOf: null, sleeperLeagueId: 'league', seasonsScanned: ['2026'], currentSeasonPartial: true,
  gradeScale: { description: '', thresholds: [], tieBand: 0 }, contextNotes: [], trades, missing: [],
})
const gradeFor = (id: string) => ({ graded: true, letter: 'B', partnerLetter: 'D', tradeId: id })
const expectationFor = (id: string) => ({ sides: [], evaluation: { scope: 'market-only' }, tradeId: id })
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('grading a trade history', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.cache.clear()
    mocks.feed.mockResolvedValue([])
  })

  it('runs as a pool of six across the whole set, so one slow trade never idles the other slots', async () => {
    let inFlight = 0
    let peak = 0
    let startedWhileFirstRan = 0
    let firstDone = false
    mocks.oneGrade.mockImplementation(async (_row: string, t: GradedTrade) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      if (!firstDone && t.id !== 'league:tx0') startedWhileFirstRan += 1
      // The first trade is slow; the rest are quick.
      await tick(t.id === 'league:tx0' ? 120 : 5)
      if (t.id === 'league:tx0') firstDone = true
      inFlight -= 1
      return gradeFor(t.id)
    })
    mocks.expectation.mockImplementation(async (_l: string, t: GradedTrade) => expectationFor(t.id))
    const trades = Array.from({ length: 30 }, (_, i) => trade(i))
    await gradeHistoryTrades({ sleeperLeagueId: 'league', trades, afLeagueId: 'row', currentSeason: 2026, frozen: new Map(), now: new Date() })

    expect(HISTORY_GRADE_CONCURRENCY).toBe(6)
    expect(peak).toBe(6)
    /*
     * Batches of four would start only the three trades beside the slow one until it finished. A pool
     * keeps five slots turning over the whole time, so every other trade starts while it runs.
     */
    expect(startedWhileFirstRan).toBe(29)
  })

  it('returns the same values in the same order as grading one at a time', async () => {
    mocks.oneGrade.mockImplementation(async (_row: string, t: GradedTrade) => {
      // Finish out of order on purpose: later trades resolve first.
      await tick(Number(t.id.replace('league:tx', '')) % 3 === 0 ? 15 : 1)
      return gradeFor(t.id)
    })
    mocks.expectation.mockImplementation(async (_l: string, t: GradedTrade) => expectationFor(t.id))
    const trades = Array.from({ length: 20 }, (_, i) => trade(i))
    const args = { sleeperLeagueId: 'league', trades, afLeagueId: 'row', currentSeason: 2026, frozen: new Map(), now: new Date() }
    const pooled = await gradeHistoryTrades(args)
    const sequential = await gradeHistoryTrades({ ...args, concurrency: 1 })
    expect(pooled).toEqual(sequential)
    expect(pooled.map((g) => g.leagueGrade && (g.leagueGrade as unknown as { tradeId: string }).tradeId)).toEqual(trades.map((t) => t.id))
    // Projections only for trades without realized points — odd ids here.
    expect(pooled.map((g) => g.expectation != null)).toEqual(trades.map((_, i) => i % 2 === 1))
  })

  it('hands every projection in one history the SAME shared memo', async () => {
    mocks.oneGrade.mockImplementation(async (_row: string, t: GradedTrade) => gradeFor(t.id))
    mocks.expectation.mockImplementation(async (_l: string, t: GradedTrade) => expectationFor(t.id))
    const trades = Array.from({ length: 8 }, (_, i) => trade(i, false))
    await gradeHistoryTrades({ sleeperLeagueId: 'league', trades, afLeagueId: 'row', currentSeason: 2026, frozen: new Map(), now: new Date() })
    const memos = new Set(mocks.expectation.mock.calls.map((c) => (c[2] as { shared: unknown }).shared))
    expect(mocks.expectation).toHaveBeenCalledTimes(8)
    expect(memos.size).toBe(1)
  })
})

describe('a second load of the same history', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.cache.clear()
    mocks.feed.mockResolvedValue([])
    mocks.oneGrade.mockImplementation(async (_row: string, t: GradedTrade) => gradeFor(t.id))
    mocks.expectation.mockImplementation(async (_l: string, t: GradedTrade) => expectationFor(t.id))
    mocks.save.mockResolvedValue(true)
  })
  const settle = () => tick(0)

  it('reuses the graded history instead of grading it again — and renders the same values', async () => {
    mocks.grades.mockResolvedValue(payload([trade(1), trade(2)]))
    const first = await getSleeperTradeHistory('league', 'owner-1', { afLeagueId: 'row' })
    await settle()
    expect(mocks.oneGrade).toHaveBeenCalledTimes(2)
    const second = await getSleeperTradeHistory('league', 'owner-1', { afLeagueId: 'row' })
    expect(mocks.oneGrade).toHaveBeenCalledTimes(2)
    expect(mocks.expectation).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
  })

  it('grades again the moment the ledger changes', async () => {
    mocks.grades.mockResolvedValue(payload([trade(1)], '2026-11-06T00:00:00.000Z'))
    await getSleeperTradeHistory('league', 'owner-1', { afLeagueId: 'row' })
    await settle()
    mocks.grades.mockResolvedValue(payload([trade(1), trade(3)], '2026-11-06T00:05:00.000Z'))
    const after = await getSleeperTradeHistory('league', 'owner-1', { afLeagueId: 'row' })
    expect(mocks.oneGrade).toHaveBeenCalledTimes(3)
    expect(after?.history.map((h) => h.transactionId)).toEqual(['league:tx3', 'league:tx1'])
  })

  /*
   * ⚠ THE SAME TRADES ON A REBUILT LEDGER ARE NOT THE SAME HISTORY. The 6-hour rebuild re-tallies
   * realized points without adding a trade, so trade ids alone cannot tell the entry is stale — only
   * the ledger's `fetchedAt` can. (The test above cannot see this: a new trade misses on its id.)
   */
  it('grades again when the ledger is rebuilt, even with the same trades in it', async () => {
    mocks.grades.mockResolvedValue(payload([trade(1)], '2026-11-06T00:00:00.000Z'))
    await getSleeperTradeHistory('league', 'owner-1', { afLeagueId: 'row' })
    await settle()
    mocks.grades.mockResolvedValue(payload([trade(1)], '2026-11-06T06:00:00.000Z'))
    await getSleeperTradeHistory('league', 'owner-1', { afLeagueId: 'row' })
    expect(mocks.oneGrade).toHaveBeenCalledTimes(2)
  })

  it('never keeps a history in which a grade failed', async () => {
    mocks.grades.mockResolvedValue(payload([trade(1), trade(2)]))
    mocks.oneGrade.mockImplementation(async (_row: string, t: GradedTrade) => {
      if (t.id === 'league:tx2') throw new Error('chart down')
      return gradeFor(t.id)
    })
    const first = await getSleeperTradeHistory('league', 'owner-1', { afLeagueId: 'row' })
    await settle()
    expect(first?.history.find((h) => h.transactionId === 'league:tx2')?.leagueGrade).toBeNull()
    expect(mocks.cache.size).toBe(0)
    mocks.oneGrade.mockImplementation(async (_row: string, t: GradedTrade) => gradeFor(t.id))
    const second = await getSleeperTradeHistory('league', 'owner-1', { afLeagueId: 'row' })
    expect(second?.history.find((h) => h.transactionId === 'league:tx2')?.leagueGrade).toEqual(gradeFor('league:tx2'))
  })

  it('never keeps a history whose frozen originals failed to save', async () => {
    mocks.grades.mockResolvedValue(payload([trade(1)]))
    mocks.save.mockResolvedValue(false)
    await getSleeperTradeHistory('league', 'owner-1', { afLeagueId: 'row' })
    await settle()
    expect(mocks.cache.size).toBe(0)
  })

  it('does not reuse an entry past its ten minutes', async () => {
    mocks.grades.mockResolvedValue(payload([trade(1)]))
    await getSleeperTradeHistory('league', 'owner-1', { afLeagueId: 'row' })
    await settle()
    for (const entry of mocks.cache.values()) entry.expiresAt = new Date(Date.now() - 1)
    await getSleeperTradeHistory('league', 'owner-1', { afLeagueId: 'row' })
    expect(mocks.oneGrade).toHaveBeenCalledTimes(2)
  })
})
