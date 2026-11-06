import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GradedTrade, TradeSideGrade } from '@/lib/trade-intel/sleeperTradeGradeService'

/*
 * `tradeExpectationShared`: a history of N trades on one league used to read every league-scoped
 * input N times — the league context, the market and DynastyProcess charts, a whole season's stat
 * board (multi-MB JSON), a live Sleeper roster call — and re-score and re-blend them each time. With
 * the memo each is read once, and every trade's projection is built from exactly the same inputs.
 */

const m = vi.hoisted(() => ({
  context: vi.fn(),
  leagueRow: vi.fn(),
  market: vi.fn(),
  dynasty: vi.fn(),
  board: vi.fn(),
  rosters: vi.fn(),
  score: vi.fn(),
  build: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { league: { findFirst: m.leagueRow } } }))
vi.mock('@/lib/league-context/leagueContextService', () => ({ getLeagueContext: m.context }))
vi.mock('@/lib/sports-data/sleeperMarketService', () => ({ getSeasonStatsBoard: m.board, scoreStatLine: m.score }))
vi.mock('@/lib/trade-intel/marketValueService', () => ({ getMarketValues: m.market }))
vi.mock('@/lib/trade-intel/dynastyProcessSync', () => ({ getDynastyProcessValues: m.dynasty }))
vi.mock('@/lib/trade-intel/sleeperTradeSync', () => ({ fetchLeagueRosters: m.rosters }))
vi.mock('@/lib/decision-os/trade/completedTradeGrade', () => ({ oneGradeForCompletedTrade: vi.fn(async () => null) }))
/* The projection itself: record exactly what it was handed, so the two runs can be compared input for input. */
vi.mock('@/lib/trade-intel/tradeExpectation', () => ({
  buildTradeExpectation: m.build,
  withOneGrade: (e: unknown) => e,
}))

import { loadTradeExpectation, tradeExpectationShared } from '@/lib/trade-intel/tradeExpectationLoader'

const context = {
  version: 1, fetchedAt: '2026-11-06T00:00:00Z', sleeperLeagueId: 'league', name: 'L', season: '2026', status: 'in_season', teams: 12,
  variant: { idp: false, superflex: false, dynasty: true, keeper: false, bestBall: false },
  roster: { positions: ['QB', 'RB', 'WR'], starters: { QB: 1, RB: 1, WR: 1 }, starterCount: 3, bench: 5 },
  scoring: { settings: { rec: 1 }, receptionWeight: 1, format: 'ppr' },
}
const side = (rosterId: number): TradeSideGrade => ({
  rosterId, ownerId: `o${rosterId}`, managerName: `M${rosterId}`, teamName: null, avatar: null,
  playersIn: [], playersOut: [], picksIn: [], picksOut: [], madePlayoffs: null, seasonNets: [], cumulativeNet: 0,
  initialGrade: 'C', currentGrade: 'C', trend: 'steady',
})
const trade = (n: number): GradedTrade => ({
  id: `league:tx${n}`, season: '2026', week: n, createdIso: '2026-10-01T00:00:00Z', multiTeam: false, tie: false, hasPendingPicks: false,
  sides: [side(1), side(2)],
})

describe('league-scoped inputs shared across one history', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    m.context.mockResolvedValue(context)
    m.leagueRow.mockResolvedValue(null)
    m.market.mockResolvedValue({ bySleeperId: { a: { value: 9000 }, b: { value: 4000 } }, pickByRound: { '2027:1': 6000 } })
    m.dynasty.mockResolvedValue({ bySleeperId: { a: 80, b: 40 }, pickByRound: { '2027:1': 60 } })
    m.board.mockResolvedValue({ version: 1, season: '2025', players: {
      a: { playerId: 'a', name: 'A', position: 'WR', team: null, stats: { pts: 200, gp: 17 } },
      b: { playerId: 'b', name: 'B', position: 'RB', team: null, stats: { pts: 100, gp: 12 } },
    } })
    m.rosters.mockResolvedValue([{ roster_id: 1, players: ['a'] }, { roster_id: 2, players: ['b'] }])
    m.score.mockImplementation((stats: { pts?: number }) => ({ points: stats.pts ?? 0, mode: 'league-scored' }))
    m.build.mockImplementation(() => ({ sides: [], evaluation: { scope: 'full' } }))
  })

  it('reads each league-scoped input once for the whole history, not once per trade', async () => {
    const shared = tradeExpectationShared()
    for (let i = 0; i < 5; i += 1) await loadTradeExpectation('league', trade(i), { afLeagueId: 'row', shared })
    for (const fn of [m.context, m.leagueRow, m.market, m.dynasty, m.board, m.rosters]) expect(fn).toHaveBeenCalledTimes(1)
    // The board is re-scored once (two players), not once per trade (ten).
    expect(m.score).toHaveBeenCalledTimes(2)
    expect(m.build).toHaveBeenCalledTimes(5)
  })

  it('hands every trade exactly the inputs it would have read on its own', async () => {
    const shared = tradeExpectationShared()
    await Promise.all([0, 1, 2].map((i) => loadTradeExpectation('league', trade(i), { afLeagueId: 'row', shared })))
    const withMemo = m.build.mock.calls.map((c) => c[0])
    m.build.mockClear()
    for (const i of [0, 1, 2]) await loadTradeExpectation('league', trade(i), { afLeagueId: 'row' })
    const alone = m.build.mock.calls.map((c) => c[0])
    // `pickValueLookup` is a closure; compare what it answers instead of its identity.
    const plain = (p: Record<string, unknown>) => ({ ...p, pickValueLookup: (p.pickValueLookup as (s: string, r: number) => number | null)('2027', 1) })
    expect(withMemo.map(plain)).toEqual(alone.map(plain))
    expect(withMemo.map((p) => (p.trade as GradedTrade).id)).toEqual(['league:tx0', 'league:tx1', 'league:tx2'])
  })

  it('without a memo, reads per trade exactly as before', async () => {
    for (let i = 0; i < 3; i += 1) await loadTradeExpectation('league', trade(i), { afLeagueId: 'row' })
    expect(m.context).toHaveBeenCalledTimes(3)
    expect(m.rosters).toHaveBeenCalledTimes(3)
  })
})
