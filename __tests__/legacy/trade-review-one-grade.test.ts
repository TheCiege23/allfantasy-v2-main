import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/*
 * The legacy trade review (`/api/legacy/trade/review`) reads its verdict off THE trade grade.
 *
 * The CANONICAL grader is mocked at its own door (`createLeagueTradeGrader` → a grader whose `grade`
 * is a spy); the legacy door, `gradeDeal` and the review builder are real. The body's `userId` is a
 * string anyone can type, so it must never be who the grade is taken for — the session is.
 */

const mockResolveLeague = vi.hoisted(() => vi.fn())
const mockCreateGrader = vi.hoisted(() => vi.fn())
const mockGrade = vi.hoisted(() => vi.fn())
const mockSession = vi.hoisted(() => vi.fn())

vi.mock('@/lib/decision-os/trade/evaluationLeague', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/trade/evaluationLeague')>('@/lib/decision-os/trade/evaluationLeague')
  return { ...actual, resolveEvaluationLeagueId: mockResolveLeague }
})
vi.mock('@/lib/decision-os/trade/leagueTradeGrader', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/trade/leagueTradeGrader')>('@/lib/decision-os/trade/leagueTradeGrader')
  return { ...actual, createLeagueTradeGrader: mockCreateGrader }
})
vi.mock('next-auth', () => ({ getServerSession: mockSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
// tab-api imports prisma and the legacy AI context at module level; the review never touches them.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/legacy-ai-context', () => ({ assembleLegacyAIContext: vi.fn() }))

import { POST } from '@/server/api-route-modules/legacy/trade/review/route'

type Letter = 'A' | 'B' | 'C' | 'D' | 'F'
const view = (letter: Letter, giveValue: number, getValue: number) => ({
  graded: true,
  letter,
  partnerLetter: ({ A: 'F', B: 'D', C: 'C', D: 'B', F: 'A' } as const)[letter],
  percentDiff: 0,
  label: { A: 'Major win (you)', B: 'Slightly favors you', C: 'Even', D: 'Slightly favors opponent', F: 'Major overpay' }[letter],
  sideAdvantage: 'even',
  action: 'review',
  recommendation: `Canonical says ${letter}.`,
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
})

const asset = (name: string) => ({ assetType: 'player', assetId: name, name })
const BODY = {
  leagueId: 'sleeper-1',
  userId: 'someone-else',
  mode: 'manual',
  includeCounterSuggestions: true,
  includeRenegotiationAdvice: true,
  trade: {
    fromTeamId: '1',
    toTeamId: '2',
    send: [asset('Bijan Robinson'), { assetType: 'pick', assetId: 'p', name: '2027 1st', season: 2027, round: 1 }],
    receive: [asset('Puka Nacua')],
  },
}

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/legacy/trade/review', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  for (const m of [mockResolveLeague, mockCreateGrader, mockGrade, mockSession]) m.mockReset()
  mockSession.mockResolvedValue({ user: { id: 'af-user-1' } })
  mockResolveLeague.mockResolvedValue('af-league-1')
  mockCreateGrader.mockResolvedValue({ leagueId: 'af-league-1', chart: {}, leagueType: {}, grade: mockGrade })
  mockGrade.mockResolvedValue(view('F', 9000, 4000))
})

describe('/api/legacy/trade/review — the verdict is the canonical grader’s', () => {
  it('grades for the SIGNED-IN user, never the body userId: send is given, receive is got', async () => {
    expect((await post(BODY)).status).toBe(200)
    expect(mockResolveLeague).toHaveBeenCalledWith({ suppliedLeagueId: 'sleeper-1', userId: 'af-user-1' })
    expect(mockGrade).toHaveBeenNthCalledWith(1, {
      give: [{ kind: 'player', name: 'Bijan Robinson' }, { kind: 'pick', year: 2027, round: 1, label: '2027 1st' }],
      get: [{ kind: 'player', name: 'Puka Nacua' }],
      viewerSide: false,
    })
  })

  it('recommendation, grade, values and commissioner alert follow the canonical letter — and change with it', async () => {
    const f = (await (await post(BODY)).json()).data.review
    expect(f).toMatchObject({
      recommendation: 'reject',
      grade: { graded: true, letter: 'F', giveValue: 9000, getValue: 4000 },
      fairnessScore: null,
      confidence: null,
      scoreBreakdown: { rawValueScore: -5000, sendValue: 9000, receiveValue: 4000 },
      commissionerAlert: { required: true, reason_codes: ['high_imbalance'] },
      gradeSource: 'one_trade_engine',
    })

    mockGrade.mockResolvedValue(view('B', 5000, 5600))
    const b = (await (await post(BODY)).json()).data.review
    expect(b).toMatchObject({
      recommendation: 'accept',
      grade: { letter: 'B' },
      scoreBreakdown: { rawValueScore: 600 },
      commissionerAlert: { required: false, reason_codes: [] },
    })
    expect(b.reasonSummary[1]).toBe('Canonical says B.')
  })

  it('a counter suggestion carries the canonical grade of the sub-deal it names', async () => {
    mockGrade.mockResolvedValueOnce(view('D', 9000, 7000)).mockResolvedValueOnce(view('C', 5000, 5100))
    const review = (await (await post(BODY)).json()).data.review
    expect(mockGrade).toHaveBeenNthCalledWith(2, { give: [{ kind: 'player', name: 'Bijan Robinson' }], get: [{ kind: 'player', name: 'Puka Nacua' }], viewerSide: false })
    expect(review.recommendation).toBe('counter')
    expect(review.counterSuggestions[0].grade).toMatchObject({ graded: true, letter: 'C' })
    expect(review.counterSuggestions[0]).not.toHaveProperty('fairnessScore')
    expect(review.renegotiationAdvice.shouldReopen).toBe(true)
  })

  it('a canonical WITHHOLD holds, says why, and flags the commissioner — no number stands in', async () => {
    mockGrade.mockResolvedValue({ graded: false, reason: 'Puka Nacua could not be found.', basis: null })
    const res = await (await post(BODY)).json()
    expect(res.data.review).toMatchObject({
      recommendation: 'hold',
      grade: { graded: false, reason: 'Puka Nacua could not be found.' },
      gradeWithheld: 'Puka Nacua could not be found.',
      fairnessScore: null,
      scoreBreakdown: { rawValueScore: null },
      reasonSummary: ['Not graded: Puka Nacua could not be found.'],
      commissionerAlert: { required: true, reason_codes: ['not_graded'] },
    })
    expect(res.meta.missingFields).toEqual(['confidence', 'grade'])
  })

  it('no session: withheld, the grader never built', async () => {
    mockSession.mockResolvedValue(null)
    const review = (await (await post(BODY)).json()).data.review
    expect(review.grade.graded).toBe(false)
    expect(mockCreateGrader).not.toHaveBeenCalled()
  })
})
