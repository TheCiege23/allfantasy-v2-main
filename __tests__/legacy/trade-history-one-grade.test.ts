import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/*
 * The AF Legacy report card's per-trade grades (`/api/legacy/trade-history`, `action: 'grade'`) come
 * from THE completed-trade grade — `oneGradeForCompletedTrade`, the function `/api/legacy/trade-analytics`,
 * the /core Trades history and the grade email read. That canonical function is mocked (with the league
 * resolution, the frozen-original read and the session); the legacy adapter between it and the route is
 * real. `lib/hybrid-valuation` is a spy that returns plausible prices and must never be called; the LLM
 * is a spy whose prompt must carry the canonical verdict and whose own letters are discarded.
 */

const mockResolveLeague = vi.hoisted(() => vi.fn())
const mockOneGrade = vi.hoisted(() => vi.fn())
const mockLoadFrozen = vi.hoisted(() => vi.fn())
const mockSession = vi.hoisted(() => vi.fn())
const mockPricePlayer = vi.hoisted(() => vi.fn())
const mockPricePick = vi.hoisted(() => vi.fn())
const mockLlm = vi.hoisted(() => vi.fn())

vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (handler: unknown) => handler }))
vi.mock('@/lib/legacy/sleeper-boundary', () => ({ assertSleeperBoundaryForLeagueId: async () => ({ ok: true }) }))
vi.mock('@/lib/sleeper-client', () => ({
  getLeagueTransactions: vi.fn(), getLeagueRosters: vi.fn(), getLeagueUsers: vi.fn(),
  getLeagueHistory: vi.fn(), resolveSleeperUser: vi.fn(),
}))
vi.mock('@/lib/canonical/getCanonicalPlayer', () => ({ getCanonicalPlayerMapForSport: vi.fn() }))
vi.mock('@/lib/ai/openai-route-client', () => ({
  getOpenAIRouteClient: () => ({ chat: { completions: { create: (...a: unknown[]) => mockLlm(...a) } } }),
}))
vi.mock('@/lib/decision-os/trade/evaluationLeague', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/trade/evaluationLeague')>('@/lib/decision-os/trade/evaluationLeague')
  return { ...actual, resolveEvaluationLeagueId: mockResolveLeague }
})
vi.mock('@/lib/decision-os/trade/completedTradeGrade', () => ({ oneGradeForCompletedTrade: mockOneGrade }))
vi.mock('@/lib/decision-os/trade/frozenCompletedGrade', () => ({ loadFrozenCompletedGrades: mockLoadFrozen }))
vi.mock('next-auth', () => ({ getServerSession: mockSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/hybrid-valuation', () => ({ pricePlayer: mockPricePlayer, pricePick: mockPricePick }))

import { POST } from '@/server/api-route-modules/legacy/trade-history/route'
import { proseNamesAGrade } from '@/lib/legacy/legacyPackageGrade'
import { NOT_YOUR_LEAGUE_REASON } from '@/lib/decision-os/trade/evaluationLeague'

type Letter = 'A' | 'B' | 'C' | 'D' | 'F'
const view = (letter: Letter, giveValue: number, getValue: number, current?: { letter: Letter; giveValue: number; getValue: number }) => ({
  graded: true,
  letter,
  partnerLetter: letter === 'B' ? 'D' : letter === 'D' ? 'B' : letter === 'A' ? 'F' : letter === 'F' ? 'A' : 'C',
  percentDiff: 0,
  label: `Canonical label ${letter}`,
  sideAdvantage: 'even',
  action: 'review',
  recommendation: `Canonical recommendation ${letter}.`,
  giveValue,
  getValue,
  giveMarket: giveValue,
  getMarket: getValue,
  basis: 'Dynasty · 12 teams · PPR',
  scoringApplied: true,
  needApplied: false,
  needGap: null,
  lines: [],
  moves: [],
  current: current ? { ...current, partnerLetter: 'C' } : null,
})

// The shape `action: 'fetch'` returns and the page sends back. The viewer is roster 4 (side B here),
// so a grader that read "side A" as the viewer would get every letter backwards.
const TRADE = {
  transactionId: 'tx-1',
  timestamp: Date.UTC(2025, 8, 1),
  week: 3,
  season: '2025',
  userInvolved: true,
  userSide: 'received',
  userRosterId: 4,
  parties: [
    { rosterId: 2, userId: 'opp-id', displayName: 'Rival', playersReceived: [{ id: '8155', name: 'Breece Hall', position: 'RB', team: 'NYJ' }], picksReceived: [], faabReceived: 0 },
    { rosterId: 4, userId: 'me-id', displayName: 'Me', playersReceived: [{ id: '9493', name: 'Puka Nacua', position: 'WR', team: 'LAR' }], picksReceived: [{ season: '2026', round: 2 }], faabReceived: 0 },
  ],
}
const BODY = { leagueId: 'sleeper-1', userId: 'me-id', action: 'grade', trade: TRADE }

const post = (body: unknown) =>
  (POST as unknown as (req: NextRequest) => Promise<Response>)(
    new NextRequest('http://localhost/api/legacy/trade-history', { method: 'POST', body: JSON.stringify(body) }),
  )
const llmSays = (brief: string, full: string) =>
  mockLlm.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ brief, full }) } }] })

beforeEach(() => {
  for (const m of [mockResolveLeague, mockOneGrade, mockLoadFrozen, mockSession, mockPricePlayer, mockPricePick, mockLlm]) m.mockReset()
  mockSession.mockResolvedValue({ user: { id: 'af-user-1' } })
  mockResolveLeague.mockResolvedValue('af-league-1')
  mockLoadFrozen.mockResolvedValue(new Map())
  mockOneGrade.mockResolvedValue(view('B', 6000, 7000, { letter: 'A', giveValue: 5000, getValue: 8000 }))
  // Plausible hybrid prices: an old route would happily grade on these.
  mockPricePlayer.mockResolvedValue({ value: 5000, source: 'fantasycalc' })
  mockPricePick.mockResolvedValue({ value: 1200, source: 'curve' })
  llmSays('Puka was the better long-term piece here.', 'You took on the younger receiver and a pick for a back.')
})

describe('/api/legacy/trade-history action:grade — the canonical completed-trade grade', () => {
  it('hands the trade to the canonical grader on the caller’s own league, from the VIEWER’s side', async () => {
    expect((await post(BODY)).status).toBe(200)
    expect(mockResolveLeague).toHaveBeenCalledWith({ suppliedLeagueId: 'sleeper-1', userId: 'af-user-1' })
    expect(mockLoadFrozen).toHaveBeenCalledWith('af-league-1', ['tx-1'])
    const [league, ledgerTrade, , deps] = mockOneGrade.mock.calls[0]!
    expect(league).toBe('af-league-1')
    expect(ledgerTrade.id).toBe('tx-1')
    expect(ledgerTrade.sides[0].playersIn).toEqual([expect.objectContaining({ name: 'Puka Nacua', playerId: '9493' })])
    expect(ledgerTrade.sides[0].picksIn).toEqual([expect.objectContaining({ season: '2026', round: 2 })])
    expect(ledgerTrade.sides[0].playersOut).toEqual([expect.objectContaining({ name: 'Breece Hall', playerId: '8155' })])
    expect(() => deps.onFreeze({}, {})).not.toThrow() // read-only: never writes a frozen original
    expect(mockPricePlayer).not.toHaveBeenCalled()
    expect(mockPricePick).not.toHaveBeenCalled()
  })

  it('letter, win/loss and value are the canonical ones', async () => {
    const { gradedTrade } = await (await post(BODY)).json()
    expect(gradedTrade).toMatchObject({
      gradeSource: 'one_trade_engine',
      graded: true,
      grade: 'B',
      partnerGrade: 'D',
      currentGrade: 'A',
      result: 'win',
      winner: 'Me',
      valueDifferential: 1000,
      currentValueDifferential: 3000,
      gradeWithheld: null,
      transactionId: 'tx-1',
    })
  })

  it('CHANGES when the canonical grade changes — same trade, different canonical verdict', async () => {
    mockOneGrade.mockResolvedValue(view('F', 9000, 3000))
    const { gradedTrade } = await (await post(BODY)).json()
    expect(gradedTrade).toMatchObject({ grade: 'F', currentGrade: 'F', result: 'loss', winner: 'Rival', valueDifferential: -6000 })
    mockOneGrade.mockResolvedValue(view('C', 5000, 5100))
    const even = (await (await post(BODY)).json()).gradedTrade
    expect(even).toMatchObject({ grade: 'C', result: 'even', winner: 'Even', valueDifferential: 100 })
  })

  it('the LLM is handed the canonical verdict, and is not the source of any letter', async () => {
    const { gradedTrade } = await (await post(BODY)).json()
    const prompt: string = mockLlm.mock.calls[0]![0].messages[0].content
    expect(prompt).toContain('Canonical label B')
    expect(prompt).toContain('Canonical recommendation B.')
    expect(prompt).toContain('received 7000, sent 6000')
    expect(prompt).toMatch(/do not write any letter grade/i)
    expect(gradedTrade.briefExplanation).toBe('Puka was the better long-term piece here.')
  })

  it('prose that writes its own letter grade is dropped for the grade’s own label and recommendation', async () => {
    llmSays('I would grade this an A+.', 'Clear win.')
    const { gradedTrade } = await (await post(BODY)).json()
    expect(gradedTrade.grade).toBe('B')
    expect(gradedTrade.briefExplanation).toBe('Canonical label B')
    expect(gradedTrade.fullAnalysis).toBe('Canonical recommendation B.')
  })

  it('an LLM failure still returns the canonical grade, with its own words', async () => {
    mockLlm.mockRejectedValue(new Error('down'))
    const { gradedTrade } = await (await post(BODY)).json()
    expect(gradedTrade).toMatchObject({ grade: 'B', result: 'win', briefExplanation: 'Canonical label B' })
  })

  it('withheld: not graded, with the grader’s reason, no value, no winner, and no LLM call', async () => {
    mockOneGrade.mockResolvedValue({ graded: false, reason: 'Puka Nacua could not be priced.', basis: null })
    const { gradedTrade } = await (await post(BODY)).json()
    expect(gradedTrade).toMatchObject({
      graded: false, grade: null, currentGrade: null, result: null, winner: null,
      valueDifferential: null, gradeWithheld: 'Puka Nacua could not be priced.', briefExplanation: 'Not graded',
    })
    expect(mockLlm).not.toHaveBeenCalled()
  })

  it('a league that is not the caller’s, or no session: withheld with that reason, grader never called', async () => {
    mockResolveLeague.mockResolvedValue(null)
    expect((await (await post(BODY)).json()).gradedTrade).toMatchObject({ graded: false, gradeWithheld: NOT_YOUR_LEAGUE_REASON })
    mockSession.mockResolvedValue(null)
    const noSession = (await (await post(BODY)).json()).gradedTrade
    expect(noSession.graded).toBe(false)
    expect(noSession.gradeWithheld).toMatch(/sign in/i)
    expect(mockOneGrade).not.toHaveBeenCalled()
    expect(mockPricePlayer).not.toHaveBeenCalled()
  })
})

describe('proseNamesAGrade', () => {
  it.each([
    ['I would grade this an A+.', true],
    ['This deserves a B- at best', true],
    ['graded a C overall', true],
    ['Letter grade: D', true],
    ['A clear win for you', false],
    ['You gave up a lot. A tough one.', false],
    ['Puka Nacua is a WR1 for years.', false],
  ])('%s → %s', (text, expected) => {
    expect(proseNamesAGrade(text)).toBe(expected)
  })
})
