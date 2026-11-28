import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The Share tab's Trade Vote (`/api/legacy/trade-vote-analyze`) prints THE trade grade.
 *
 * The CANONICAL grader is mocked at its own door — `createLeagueTradeGrader` returns a grader whose
 * `grade` is a spy — and the league resolution and session are mocked. Everything between (the legacy
 * door, `gradeDeal`, the input reader) is real, so the test proves the letter on the response is the
 * canonical grader's, and that it moves when the canonical one moves. `lib/hybrid-valuation` is a spy
 * that must never be called.
 */

const mockResolveLeague = vi.hoisted(() => vi.fn())
const mockCreateGrader = vi.hoisted(() => vi.fn())
const mockGrade = vi.hoisted(() => vi.fn())
const mockSession = vi.hoisted(() => vi.fn())
const mockHybrid = vi.hoisted(() => vi.fn())

vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (handler: unknown) => handler }))
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
vi.mock('@/lib/hybrid-valuation', () => ({ priceAssets: mockHybrid, pricePlayer: mockHybrid, pricePick: mockHybrid }))

import { POST } from '@/server/api-route-modules/legacy/trade-vote-analyze/route'
import { NO_LEAGUE_TO_GRADE_REASON } from '@/lib/legacy/legacyOneGrade'
import { NOT_YOUR_LEAGUE_REASON } from '@/lib/decision-os/trade/evaluationLeague'

const view = (letter: 'A' | 'B' | 'C' | 'D' | 'F', partnerLetter: 'A' | 'B' | 'C' | 'D' | 'F', giveValue: number, getValue: number) => ({
  graded: true,
  letter,
  partnerLetter,
  percentDiff: 0,
  label: letter === 'C' ? 'Even' : letter === 'F' ? 'Major overpay' : 'Slightly favors you',
  sideAdvantage: 'even',
  action: 'review',
  recommendation: `Canonical says ${letter}.`,
  giveValue,
  getValue,
  giveMarket: giveValue,
  getMarket: getValue,
  basis: 'Dynasty · Superflex · 12 teams · PPR',
  scoringApplied: true,
  needApplied: false,
  needGap: null,
  lines: [],
  moves: [],
})

const post = (body: unknown) =>
  (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://localhost/api/legacy/trade-vote-analyze', { method: 'POST', body: JSON.stringify(body) }),
  )

const BODY = { side_a: ["Ja'Marr Chase", '2026 1st'], side_b: ['CeeDee Lamb'], league_id: 'sleeper-1' }

beforeEach(() => {
  for (const m of [mockResolveLeague, mockCreateGrader, mockGrade, mockSession, mockHybrid]) m.mockReset()
  mockSession.mockResolvedValue({ user: { id: 'af-user-1' } })
  mockResolveLeague.mockResolvedValue('af-league-1')
  mockCreateGrader.mockResolvedValue({ leagueId: 'af-league-1', chart: {}, leagueType: {}, grade: mockGrade })
  mockGrade.mockResolvedValue(view('F', 'A', 9000, 4000))
})

describe('/api/legacy/trade-vote-analyze — the verdict is the canonical grader’s', () => {
  it('grades in the caller’s own league: Side A sends side_a (a typed pick read as a pick) and receives side_b', async () => {
    expect((await post(BODY)).status).toBe(200)
    expect(mockResolveLeague).toHaveBeenCalledWith({ suppliedLeagueId: 'sleeper-1', userId: 'af-user-1' })
    expect(mockCreateGrader).toHaveBeenCalledWith({ leagueId: 'af-league-1', userId: 'af-user-1' })
    expect(mockGrade).toHaveBeenCalledWith({
      give: [{ kind: 'player', name: "Ja'Marr Chase" }, expect.objectContaining({ kind: 'pick', year: 2026, round: 1 })],
      get: [{ kind: 'player', name: 'CeeDee Lamb' }],
      viewerSide: false,
    })
  })

  it('prints the canonical letter, its mirror and its league values — and CHANGES when the canonical one does', async () => {
    const first = await (await post(BODY)).json()
    expect(first).toMatchObject({ success: true, grade: 'F', partner_grade: 'A', side_a_value: 9000, side_b_value: 4000, gradeSource: 'one_trade_engine' })
    expect(first.verdict).toContain('Canonical says F.')

    mockGrade.mockResolvedValue(view('B', 'D', 5000, 5600))
    const second = await (await post(BODY)).json()
    expect(second).toMatchObject({ grade: 'B', partner_grade: 'D', side_a_value: 5000, side_b_value: 5600 })
    expect(mockHybrid).not.toHaveBeenCalled()
  })

  it('a canonical WITHHOLD is a withheld vote with the reason, never a letter or a value', async () => {
    mockGrade.mockResolvedValue({ graded: false, reason: 'CeeDee Lamb could not be found.', basis: null })
    const data = await (await post(BODY)).json()
    expect(data).toMatchObject({ success: true, grade: null, partner_grade: null, side_a_value: null, side_b_value: null, diff_pct: null })
    expect(data.gradeWithheld).toBe('CeeDee Lamb could not be found.')
    expect(data.verdict).toBe('Not graded: CeeDee Lamb could not be found.')
  })

  it('no league (what the Share tab sends today) is the trade evaluator’s no-league withhold — the grader is never built', async () => {
    const data = await (await post({ side_a: ['A'], side_b: ['B'] })).json()
    expect(data.grade).toBeNull()
    expect(data.gradeWithheld).toBe(NO_LEAGUE_TO_GRADE_REASON)
    expect(mockCreateGrader).not.toHaveBeenCalled()
  })

  it('a league that is not the caller’s is withheld with that reason', async () => {
    mockResolveLeague.mockResolvedValue(null)
    const data = await (await post(BODY)).json()
    expect(data.gradeWithheld).toBe(NOT_YOUR_LEAGUE_REASON)
    expect(mockCreateGrader).not.toHaveBeenCalled()
  })

  it('still refuses an empty side', async () => {
    expect((await post({ side_a: [], side_b: ['B'] })).status).toBe(400)
  })
})
