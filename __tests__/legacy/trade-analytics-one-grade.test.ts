import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/*
 * The AF Legacy trade report (`/api/legacy/trade-analytics`) grades history through THE completed-trade
 * grade — `oneGradeForCompletedTrade`, the same function the /core Trades history and the grade email
 * read. That canonical function is mocked (with the league resolution, the frozen-original read and the
 * session); the legacy adapter between it and the route is real. So these tests prove: the trade is
 * handed to the canonical grader from the viewer's side, every letter, win/loss and value on the report
 * is the canonical one, it MOVES when the canonical one moves, a withheld trade counts nowhere, and the
 * report never freezes an original. `lib/hybrid-valuation` is a spy that must never be called.
 */

const mockResolveLeague = vi.hoisted(() => vi.fn())
const mockOneGrade = vi.hoisted(() => vi.fn())
const mockLoadFrozen = vi.hoisted(() => vi.fn())
const mockSession = vi.hoisted(() => vi.fn())
const mockGate = vi.hoisted(() => vi.fn())
const mockHybrid = vi.hoisted(() => vi.fn())

vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (handler: unknown) => handler }))
vi.mock('@/lib/user-events', () => ({ logUserEventByUsername: vi.fn() }))
vi.mock('@/lib/legacy/requireLegacySleeperIdentity', () => ({ requireLegacySleeperIdentity: (...a: unknown[]) => mockGate(...a) }))
vi.mock('@/lib/decision-os/trade/evaluationLeague', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/trade/evaluationLeague')>('@/lib/decision-os/trade/evaluationLeague')
  return { ...actual, resolveEvaluationLeagueId: mockResolveLeague }
})
vi.mock('@/lib/decision-os/trade/completedTradeGrade', () => ({ oneGradeForCompletedTrade: mockOneGrade }))
vi.mock('@/lib/decision-os/trade/frozenCompletedGrade', () => ({ loadFrozenCompletedGrades: mockLoadFrozen }))
vi.mock('next-auth', () => ({ getServerSession: mockSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/hybrid-valuation', () => ({ computeDualModeTradeDelta: mockHybrid }))

import { POST } from '@/server/api-route-modules/legacy/trade-analytics/route'
import { NOT_YOUR_LEAGUE_REASON } from '@/lib/decision-os/trade/evaluationLeague'

type Letter = 'A' | 'B' | 'C' | 'D' | 'F'
/** A canonical completed-trade view: the original letter, and today's beside it when it differs. */
const view = (letter: Letter, giveValue: number, getValue: number, current?: { letter: Letter; giveValue: number; getValue: number }) => ({
  graded: true,
  letter,
  partnerLetter: 'C',
  percentDiff: 0,
  label: 'Even',
  sideAdvantage: 'even',
  action: 'review',
  recommendation: `Canonical original ${letter}.`,
  giveValue,
  getValue,
  giveMarket: giveValue,
  getMarket: getValue,
  basis: 'Dynasty · 12 teams · PPR',
  scoringApplied: true,
  needApplied: false,
  needGap: null,
  lines: [
    { side: 'get', name: 'Puka Nacua', marketValue: getValue, leagueValue: getValue, valueSource: 'fantasycalc' },
    { side: 'give', name: 'Breece Hall', marketValue: giveValue, leagueValue: giveValue, valueSource: 'fantasycalc' },
  ],
  moves: [],
  current: current ? { ...current, partnerLetter: 'C' } : null,
})

const party = (userId: string, teamName: string, players: Array<{ name: string; id?: string; position?: string }>, picks: Array<{ season: string; round: number }> = []) => ({
  userId, teamName, playersReceived: players, picksReceived: picks,
})
const trade = (id: string, ts: number, mine: Parameters<typeof party>[2], theirs: Parameters<typeof party>[2], opp = 'opp-1') => ({
  transactionId: id,
  timestamp: ts,
  week: 3,
  grade: 'A+', // what the CLIENT sends (another model's letter) — must be ignored
  parties: [party('me-id', 'My Team', mine), party(opp, `Team ${opp}`, theirs)],
})

const T1 = trade('t1', Date.UTC(2025, 8, 1), [{ name: 'Puka Nacua', id: '9493', position: 'WR' }], [{ name: 'Breece Hall', id: '8155', position: 'RB' }])
const T2 = trade('t2', Date.UTC(2025, 9, 1), [{ name: 'Rashee Rice', id: '9999', position: 'WR' }], [{ name: 'Joe Mixon', id: '4866', position: 'RB' }])
const T3 = trade('t3', Date.UTC(2025, 10, 1), [{ name: 'Nobody Known' }], [{ name: 'Someone' }], 'opp-2')

const BODY = { league_id: 'sleeper-1', sleeper_username: 'me', sleeper_user_id: 'me-id', trades: [T1, T2, T3], managers: {} }

const post = (body: unknown) =>
  (POST as unknown as (req: NextRequest) => Promise<Response>)(
    new NextRequest('http://localhost/api/legacy/trade-analytics', { method: 'POST', body: JSON.stringify(body) }),
  )

const byTrade = (table: Record<string, unknown>) => mockOneGrade.mockImplementation(async (_league: string, t: { id: string }) => table[t.id])

beforeEach(() => {
  for (const m of [mockResolveLeague, mockOneGrade, mockLoadFrozen, mockSession, mockGate, mockHybrid]) m.mockReset()
  mockGate.mockResolvedValue({ ok: true, identity: { sleeperUsername: 'me', actorId: 'af-user-1', source: 'session' } })
  mockSession.mockResolvedValue({ user: { id: 'af-user-1' } })
  mockResolveLeague.mockResolvedValue('af-league-1')
  mockLoadFrozen.mockResolvedValue(new Map())
  byTrade({
    t1: view('B', 6000, 7000, { letter: 'A', giveValue: 5000, getValue: 8000 }),
    t2: view('D', 7000, 6000),
    t3: { graded: false, reason: 'Nobody Known could not be found.', basis: null },
  })
})

describe('/api/legacy/trade-analytics — every trade is graded by the canonical completed-trade grade', () => {
  it('hands each trade to the canonical grader on the caller’s own league, from the viewer’s side', async () => {
    expect((await post(BODY)).status).toBe(200)
    expect(mockResolveLeague).toHaveBeenCalledWith({ suppliedLeagueId: 'sleeper-1', userId: 'af-user-1' })
    expect(mockLoadFrozen).toHaveBeenCalledWith('af-league-1', ['t1', 't2', 't3'])
    const [league, ledgerTrade, , deps] = mockOneGrade.mock.calls.find(([, t]) => t.id === 't1')!
    expect(league).toBe('af-league-1')
    expect(ledgerTrade.sides[0].playersIn).toEqual([expect.objectContaining({ name: 'Puka Nacua', playerId: '9493', position: 'WR' })])
    expect(ledgerTrade.sides[0].playersOut).toEqual([expect.objectContaining({ name: 'Breece Hall', playerId: '8155' })])
    expect(ledgerTrade.multiTeam).toBe(false)
    expect(deps.frozen).toBeInstanceOf(Map)
    // Read-only: the report never writes a frozen original.
    expect(() => deps.onFreeze({}, {})).not.toThrow()
    expect(mockHybrid).not.toHaveBeenCalled()
  })

  it('letters, outcomes and values are the canonical ones — the client’s own "A+" is ignored', async () => {
    const data = await (await post(BODY)).json()
    const t1 = data.allTrades.find((t: any) => t.id === 't1')
    expect(t1).toMatchObject({
      grade: 'B', result: 'win', netValue: 1000,
      atTimeGrade: 'B', atTimeDelta: 1000, hindsightGrade: 'A', hindsightDelta: 3000, marketShift: 2000,
      drivers: { receivedTotal: 7000, gaveTotal: 6000 },
    })
    expect(t1.drivers.received[0]).toMatchObject({ name: 'Puka Nacua', value: 7000, market: 7000, vorp: null })
    expect(data.allTrades.find((t: any) => t.id === 't2')).toMatchObject({ grade: 'D', result: 'loss', netValue: -1000 })
    expect(data.tradingStats).toMatchObject({ wins: 1, losses: 1, even: 0, netValueGained: 0 })
    expect(data.tradingStats.multiDimensional.hindsight).toMatchObject({ wins: 1, losses: 1, netValue: 2000 })
    expect(data.tradingStats.multiDimensional.lineupImpact).toBeNull()
    expect(data.gradeCard).toMatchObject({ grade: 'C', score: 50 })
    expect(data.reportCard).toBeNull()
    expect(data.gradeSource).toBe('one_trade_engine')
  })

  it('CHANGES when the canonical grade changes — same trades, a different canonical verdict, a different report', async () => {
    const before = await (await post(BODY)).json()
    byTrade({ t1: view('F', 9000, 3000), t2: view('F', 8000, 2000), t3: view('C', 5000, 5000) })
    const after = await (await post(BODY)).json()
    expect(before.gradeCard.grade).toBe('C')
    expect(after.gradeCard.grade).toBe('D') // mean of F, F, C
    expect(after.tradingStats).toMatchObject({ wins: 0, losses: 2, even: 1, netValueGained: -12000 })
    expect(after.worstTrade).toMatchObject({ value: 6000 })
    expect(after.allTrades.map((t: any) => t.grade)).toEqual(['C', 'F', 'F'])
  })

  it('hindsight mode reads today’s canonical re-grade', async () => {
    const data = await (await post({ ...BODY, mode: 'hindsight' })).json()
    expect(data.allTrades.find((t: any) => t.id === 't1')).toMatchObject({ grade: 'A', netValue: 3000 })
  })

  it('a withheld trade says why and counts in no total, win, loss or average', async () => {
    const data = await (await post(BODY)).json()
    const t3 = data.allTrades.find((t: any) => t.id === 't3')
    expect(t3).toMatchObject({ grade: 'N/A', result: 'withheld', netValue: null, gradeWithheld: 'Nobody Known could not be found.' })
    expect(data.gradedTrades).toBe(2)
    expect(data.withheldTrades).toBe(1)
    expect(data.tradingPartners.all.map((p: any) => p.name)).not.toContain('Team opp-2')
  })

  it('a league that is not the caller’s: every trade withheld with that reason; the grade card says so', async () => {
    mockResolveLeague.mockResolvedValue(null)
    const data = await (await post(BODY)).json()
    expect(mockOneGrade).not.toHaveBeenCalled()
    expect(data.allTrades.every((t: any) => t.gradeWithheld === NOT_YOUR_LEAGUE_REASON)).toBe(true)
    expect(data.gradeCard).toMatchObject({ grade: null, label: 'Not graded', gradeWithheld: NOT_YOUR_LEAGUE_REASON })
    expect(data.tradingStats).toMatchObject({ wins: 0, losses: 0, even: 0 })
  })

  it('a three-team trade reaches the canonical grader marked multi-team (which withholds it)', async () => {
    const three = { ...T1, transactionId: 't9', parties: [...T1.parties, party('x', 'Team X', [])] }
    byTrade({ t9: { graded: false, reason: 'only two-team trades are graded', basis: null } })
    await post({ ...BODY, trades: [three] })
    expect(mockOneGrade.mock.calls[0]![1].multiTeam).toBe(true)
  })
})
