import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/*
 * "What could I have done instead?" (`/api/legacy/trade-alternatives`) reads THE completed-trade grade:
 * the trade, a like-for-like baseline re-grade of it, and every counterfactual deal all go through
 * `oneGradeForCompletedTrade` (mocked, with the league resolution, frozen read and session; the legacy
 * adapter and `lib/trade-alternatives` are real). `lib/hybrid-valuation` is a spy that must never be
 * called, and the LLM only explains — it is told the verdict and its letters are discarded.
 */

const mockResolveLeague = vi.hoisted(() => vi.fn())
const mockOneGrade = vi.hoisted(() => vi.fn())
const mockLoadFrozen = vi.hoisted(() => vi.fn())
const mockSession = vi.hoisted(() => vi.fn())
const mockHybrid = vi.hoisted(() => vi.fn())
const mockLlm = vi.hoisted(() => vi.fn())

vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (handler: unknown) => handler }))
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
vi.mock('@/lib/hybrid-valuation', () => ({ computeDualModeTradeDelta: mockHybrid, pricePlayer: mockHybrid, pricePick: mockHybrid }))

import { POST } from '@/server/api-route-modules/legacy/trade-alternatives/route'
import { NOT_YOUR_LEAGUE_REASON } from '@/lib/decision-os/trade/evaluationLeague'

type Letter = 'A' | 'B' | 'C' | 'D' | 'F'
const view = (letter: Letter, giveValue: number, getValue: number) => ({
  graded: true, letter, partnerLetter: 'C', percentDiff: 0, label: 'x', sideAdvantage: 'even', action: 'review',
  recommendation: 'x', giveValue, getValue, giveMarket: giveValue, getMarket: getValue, basis: 'Dynasty',
  scoringApplied: true, needApplied: false, needGap: null, lines: [], moves: [], current: null,
})

const TRADE = {
  transactionId: 'tx-1',
  timestamp: Date.UTC(2024, 8, 1),
  week: 3,
  parties: [
    { userId: 'opp-id', displayName: 'Rival', playersReceived: [{ id: '4881', name: 'Stefon Diggs', position: 'WR' }], picksReceived: [] },
    { userId: 'me-id', displayName: 'Me', playersReceived: [{ id: '4866', name: 'Joe Mixon', position: 'RB' }], picksReceived: [] },
  ],
}
const BODY = { trade: TRADE, userId: 'me-id', leagueId: 'sleeper-1', isSuperFlex: true }
const post = async (body: unknown) =>
  (await (POST as unknown as (req: NextRequest) => Promise<Response>)(
    new NextRequest('http://localhost/api/legacy/trade-alternatives', { method: 'POST', body: JSON.stringify(body) }),
  )).json()

/** Grade by what the viewer receives in the ledger trade (side one's playersIn / picksIn). */
const gradeByReceived = (table: Record<string, unknown>, fallback: unknown) =>
  mockOneGrade.mockImplementation(async (_l: string, t: any) => {
    const key = [...t.sides[0].playersIn.map((p: any) => p.name), ...t.sides[0].picksIn.map((p: any) => p.label)].join('+')
    if (t.id === 'tx-1') return table.__original
    return table[key] ?? fallback
  })

beforeEach(() => {
  for (const m of [mockResolveLeague, mockOneGrade, mockLoadFrozen, mockSession, mockHybrid, mockLlm]) m.mockReset()
  mockSession.mockResolvedValue({ user: { id: 'af-user-1' } })
  mockResolveLeague.mockResolvedValue('af-league-1')
  mockLoadFrozen.mockResolvedValue(new Map())
  mockHybrid.mockResolvedValue({ value: 5000, source: 'fantasycalc' })
  mockLlm.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ recommended: 'Ask for Jefferson', reasoning: ['Younger', 'Higher ceiling'] }) } }] })
  gradeByReceived(
    {
      __original: view('C', 6000, 5000), // the card's (frozen) letter
      'Joe Mixon': view('D', 6000, 4800), // the baseline, priced like the alternatives
      'Justin Jefferson': view('B', 6000, 7000),
      'Tyreek Hill': view('C', 6000, 5500),
      'CeeDee Lamb': view('F', 6000, 9000), // a better net but a WORSE letter is never offered (impossible in practice, pinned anyway)
    },
    { graded: false, reason: 'unpriced', basis: null },
  )
})

describe('/api/legacy/trade-alternatives — the canonical completed-trade grade decides', () => {
  it('grades the trade, a baseline and each alternative through the canonical grader on the caller’s league', async () => {
    await post(BODY)
    expect(mockResolveLeague).toHaveBeenCalledWith({ suppliedLeagueId: 'sleeper-1', userId: 'af-user-1' })
    const ids = mockOneGrade.mock.calls.map(([, t]) => t.id)
    expect(ids[0]).toBe('tx-1')
    expect(ids).toContain('tx-1#baseline')
    expect(ids.some((id: string) => id.startsWith('tx-1#alt'))).toBe(true)
    // Alternatives never read (or write) a frozen original; only the real trade does.
    expect(mockLoadFrozen).toHaveBeenCalledTimes(1)
    expect(mockLoadFrozen).toHaveBeenCalledWith('af-league-1', ['tx-1'])
    const alt = mockOneGrade.mock.calls.find(([, t]) => t.id.startsWith('tx-1#alt'))!
    expect(alt[1].sides[0].playersOut).toEqual([expect.objectContaining({ name: 'Stefon Diggs' })]) // you still gave Diggs
    expect(mockHybrid).not.toHaveBeenCalled()
  })

  it('original letter, improvements, best alternative and confidence all come from the canonical grade', async () => {
    const data = await post(BODY)
    expect(data.gradeSource).toBe('one_trade_engine')
    expect(data.alternatives).toMatchObject({ originalGrade: 'C', originalDelta: -1000, gradeWithheld: null })
    // vs the baseline net of -1200: Jefferson +2200 (B), Hill +700 (C). Lamb's F is dropped.
    expect(data.alternatives.alternatives.map((a: any) => [a.label, a.grade, a.deltaImprovement, a.totalValue])).toEqual([
      ['Trade for Justin Jefferson instead', 'B', 2200, 7000],
      ['Trade for Tyreek Hill instead', 'C', 700, 5500],
    ])
    expect(data.alternatives.bestAlternative.label).toBe('Trade for Justin Jefferson instead')
    expect(data.confidence).toBe('High') // B beats the baseline D
    const prompt: string = mockLlm.mock.calls[0]![0].messages[0].content
    expect(prompt).toContain('Trade for Justin Jefferson instead (+2200 league value)')
    expect(prompt).toMatch(/do not write any letter grade/i)
    expect(prompt).not.toMatch(/ORIGINAL GRADE/)
  })

  it('CHANGES when the canonical grade changes: nothing grades better → no alternative', async () => {
    gradeByReceived({ __original: view('A', 5000, 8000), 'Joe Mixon': view('A', 5000, 8000) }, view('B', 5000, 6000))
    const data = await post(BODY)
    expect(data.alternatives.alternatives).toEqual([])
    expect(data.alternatives.originalGrade).toBe('A')
    expect(data.recommended).toBe('No better alternatives found')
    expect(mockLlm).not.toHaveBeenCalled()
  })

  it('LLM prose that writes its own letter is replaced by the grade’s own words', async () => {
    mockLlm.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ recommended: 'Jefferson, an A+ move', reasoning: ['Big upgrade'] }) } }] })
    const data = await post(BODY)
    expect(data.recommended).toBe('Trade for Justin Jefferson instead')
    expect(data.reasoning[0]).toBe('Graded B from your side, against C for the trade you made')
  })

  it('no league / not your league: withheld with the reason, no alternative graded, no LLM call', async () => {
    const noLeague = await post({ ...BODY, leagueId: undefined })
    expect(noLeague.alternatives.gradeWithheld).toMatch(/league/i)
    expect(noLeague.confidence).toBeNull()
    mockResolveLeague.mockResolvedValue(null)
    const notMine = await post(BODY)
    expect(notMine.alternatives).toMatchObject({ gradeWithheld: NOT_YOUR_LEAGUE_REASON, originalGrade: null, alternatives: [] })
    expect(mockOneGrade).not.toHaveBeenCalled()
    expect(mockLlm).not.toHaveBeenCalled()
  })
})
