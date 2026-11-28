import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/*
 * The AF Legacy "Portfolio Over Time" chart (`/api/legacy/portfolio/history`) reads THE completed-trade
 * grade — `oneGradeForCompletedTrade`, mocked here with the league resolution, frozen-original read and
 * session; the legacy adapter in between is real. Every point's letter, delta, best/worst and total
 * must be the canonical ones and move when they move; a withheld trade is not a point. The old engine,
 * `computeDualModeTradeDelta` (`lib/hybrid-valuation`), is a spy returning a plausible verdict that
 * must never be called.
 */

const mockResolveLeague = vi.hoisted(() => vi.fn())
const mockOneGrade = vi.hoisted(() => vi.fn())
const mockLoadFrozen = vi.hoisted(() => vi.fn())
const mockSession = vi.hoisted(() => vi.fn())
const mockHybrid = vi.hoisted(() => vi.fn())

vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (handler: unknown) => handler }))
vi.mock('@/lib/sleeper-client', () => ({
  resolveSleeperUser: async () => ({ userId: 'me-id', username: 'me' }),
  getLeagueUsers: async () => [{ user_id: 'me-id', display_name: 'Me' }, { user_id: 'opp-id', display_name: 'Rival' }],
  getLeagueRosters: async () => [{ roster_id: 1, owner_id: 'me-id' }, { roster_id: 2, owner_id: 'opp-id' }],
  getLeagueHistory: async () => [{ league_id: 'sleeper-1', season: '2025' }],
  getLeagueTransactions: async (_l: string, week: number) =>
    week === 2
      ? [
          { type: 'trade', status: 'complete', transaction_id: 't1', roster_ids: [1, 2], adds: { '9493': 1, '8155': 2 }, draft_picks: [], created: Date.UTC(2025, 8, 10), leg: 2 },
          { type: 'trade', status: 'complete', transaction_id: 't2', roster_ids: [1, 2], adds: { '4866': 1, '9999': 2 }, draft_picks: [], created: Date.UTC(2025, 8, 20), leg: 2 },
          { type: 'trade', status: 'complete', transaction_id: 't3', roster_ids: [1, 2], adds: { '1111': 1, '2222': 2 }, draft_picks: [], created: Date.UTC(2025, 8, 30), leg: 2 },
        ]
      : [],
}))
vi.mock('@/lib/canonical/getCanonicalPlayer', () => ({
  getCanonicalPlayerMapForSport: async () =>
    new Map([
      ['9493', { name: 'Puka Nacua', position: 'WR' }],
      ['8155', { name: 'Breece Hall', position: 'RB' }],
      ['4866', { name: 'Joe Mixon', position: 'RB' }],
      ['9999', { name: 'Rashee Rice', position: 'WR' }],
      ['1111', { name: 'Nobody Known', position: 'WR' }],
      ['2222', { name: 'Someone', position: 'RB' }],
    ]),
}))
vi.mock('@/lib/decision-os/trade/evaluationLeague', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/trade/evaluationLeague')>('@/lib/decision-os/trade/evaluationLeague')
  return { ...actual, resolveEvaluationLeagueId: mockResolveLeague }
})
vi.mock('@/lib/decision-os/trade/completedTradeGrade', () => ({ oneGradeForCompletedTrade: mockOneGrade }))
vi.mock('@/lib/decision-os/trade/frozenCompletedGrade', () => ({ loadFrozenCompletedGrades: mockLoadFrozen }))
vi.mock('next-auth', () => ({ getServerSession: mockSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/hybrid-valuation', () => ({ computeDualModeTradeDelta: mockHybrid }))

import { GET } from '@/server/api-route-modules/legacy/portfolio/history/route'
import { NOT_YOUR_LEAGUE_REASON } from '@/lib/decision-os/trade/evaluationLeague'

type Letter = 'A' | 'B' | 'C' | 'D' | 'F'
const view = (letter: Letter, giveValue: number, getValue: number, current?: { letter: Letter; giveValue: number; getValue: number }) => ({
  graded: true, letter, partnerLetter: 'C', percentDiff: 0, label: 'x', sideAdvantage: 'even', action: 'review',
  recommendation: 'x', giveValue, getValue, giveMarket: giveValue, getMarket: getValue, basis: 'Dynasty',
  scoringApplied: true, needApplied: false, needGap: null,
  lines: [
    { side: 'get', assetKind: 'player', name: 'Puka Nacua', marketValue: getValue, leagueValue: getValue },
    { side: 'give', assetKind: 'player', name: 'Breece Hall', marketValue: giveValue, leagueValue: giveValue },
  ],
  moves: [],
  current: current ? { ...current, partnerLetter: 'C' } : null,
})

const get = async (mode = 'atTime') =>
  (await (GET as unknown as (req: NextRequest) => Promise<Response>)(
    new NextRequest(`http://localhost/api/legacy/portfolio/history?leagueId=sleeper-1&userId=me&mode=${mode}&sf=true`),
  )).json()
const byTrade = (table: Record<string, unknown>) => mockOneGrade.mockImplementation(async (_l: string, t: { id: string }) => table[t.id])

beforeEach(() => {
  for (const m of [mockResolveLeague, mockOneGrade, mockLoadFrozen, mockSession, mockHybrid]) m.mockReset()
  mockSession.mockResolvedValue({ user: { id: 'af-user-1' } })
  mockResolveLeague.mockResolvedValue('af-league-1')
  mockLoadFrozen.mockResolvedValue(new Map())
  mockHybrid.mockResolvedValue({
    atTheTime: { deltaValue: 9999, grade: 'A+', confidence: 0.9, receivedAssets: [], gaveAssets: [] },
    withHindsight: { deltaValue: 9999, grade: 'A+', confidence: 0.9, receivedAssets: [], gaveAssets: [] },
  })
  byTrade({
    t1: view('B', 6000, 7000, { letter: 'A', giveValue: 5000, getValue: 8000 }),
    t2: view('D', 7000, 6000),
    t3: { graded: false, reason: 'Nobody Known could not be found.', basis: null },
  })
})

describe('/api/legacy/portfolio/history — every point is the canonical completed-trade grade', () => {
  it('grades each trade through the canonical grader on the caller’s own league, from the viewer’s side', async () => {
    await get()
    expect(mockResolveLeague).toHaveBeenCalledWith({ suppliedLeagueId: 'sleeper-1', userId: 'af-user-1' })
    expect(mockLoadFrozen).toHaveBeenCalledWith('af-league-1', ['t1', 't2', 't3'])
    const [, t1] = mockOneGrade.mock.calls.find(([, t]) => t.id === 't1')!
    expect(t1.sides[0].playersIn).toEqual([expect.objectContaining({ name: 'Puka Nacua', playerId: '9493' })])
    expect(t1.sides[0].playersOut).toEqual([expect.objectContaining({ name: 'Breece Hall', playerId: '8155' })])
    expect(mockHybrid).not.toHaveBeenCalled()
  })

  it('letters, deltas, totals and best/worst are canonical; a withheld trade is not a point', async () => {
    const data = await get()
    expect(data.gradeSource).toBe('one_trade_engine')
    expect(data.points.map((p: any) => [p.tradeId, p.grade, p.result, p.deltaValue, p.cumulativeValue, p.confidence])).toEqual([
      ['t1', 'B', 'win', 1000, 1000, null],
      ['t2', 'D', 'loss', -1000, 0, null],
    ])
    expect(data.totalDelta).toBe(0)
    expect(data.bestTrade.tradeId).toBe('t1')
    expect(data.worstTrade.tradeId).toBe('t2')
    expect(data.notGraded).toEqual([expect.objectContaining({ tradeId: 't3', reason: 'Nobody Known could not be found.' })])
    expect(data.meta.status.state).toBe('partial')
  })

  it('hindsight reads today’s canonical re-grade', async () => {
    const data = await get('hindsight')
    expect(data.points[0]).toMatchObject({ tradeId: 't1', grade: 'A', deltaValue: 3000 })
  })

  it('CHANGES when the canonical grade changes', async () => {
    byTrade({ t1: view('F', 9000, 3000), t2: view('A', 2000, 8000), t3: view('C', 5000, 5000) })
    const data = await get()
    expect(data.points.map((p: any) => p.grade)).toEqual(['F', 'A', 'C'])
    expect(data.totalDelta).toBe(0)
    expect(data.bestTrade.tradeId).toBe('t2')
    expect(data.worstTrade.tradeId).toBe('t1')
    expect(data.notGraded).toEqual([])
  })

  it('a league that is not the caller’s: no points, every trade not graded with that reason', async () => {
    mockResolveLeague.mockResolvedValue(null)
    const data = await get()
    expect(mockOneGrade).not.toHaveBeenCalled()
    expect(data.points).toEqual([])
    expect(data.notGraded).toHaveLength(3)
    expect(data.notGraded.every((n: any) => n.reason === NOT_YOUR_LEAGUE_REASON)).toBe(true)
    expect(data.meta.status).toMatchObject({ state: 'unavailable', message: NOT_YOUR_LEAGUE_REASON })
  })
})
