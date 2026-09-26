/**
 * The legacy shapes a surface reads off a `TradeEvaluationReceipt`, and the league gate the two
 * repointed routes use before a league id reaches the engine (2026-09-26).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findMany } } }))

import { resolveEvaluationLeagueId } from '@/lib/decision-os/trade/evaluationLeague'
import {
  gradeInputsFromLegacyAssets,
  legacyBalanceFromReceipt,
  legacyVerdictFromGrade,
  receiptGradeFields,
  receiptPromptBlock,
} from '@/lib/decision-os/trade/receiptViews'
import { gradeTrade, type TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'

/* Team A sends Alpha (4,000) and receives Bravo + a 1st (6,000): +33%, an A for A. */
const A_GRADE = gradeTrade({
  giveValue: 4000,
  getValue: 6000,
  giveMarket: 4000,
  getMarket: 6000,
  unpriced: 0,
  giveCount: 1,
  getCount: 2,
  basis: 'Dynasty · Superflex · 12 teams · PPR',
  scoringApplied: false,
  needApplied: false,
  needGap: null,
  lines: [
    { side: 'give', name: 'Alpha', marketValue: 4000, leagueValue: 4000 },
    { side: 'get', name: 'Bravo', marketValue: 3500, leagueValue: 3500 },
    { side: 'get', name: '2027 Round 1', marketValue: 2500, leagueValue: 2500 },
  ],
  moves: [],
})
const WITHHELD: TradeGradeView = { graded: false, reason: 'Nobody Special could not be found.', basis: null }

const receiptOf = (grade: TradeGradeView) => ({
  receiptId: 'rcpt_1',
  grade,
  assets: grade.graded
    ? [
        { side: 'give' as const, name: 'Alpha', kind: 'player' as const, leagueValue: 4000 },
        { side: 'get' as const, name: 'Bravo', kind: 'player' as const, leagueValue: 3500 },
        { side: 'get' as const, name: '2027 Round 1', kind: 'pick' as const, leagueValue: 2500 },
      ]
    : [{ side: 'give' as const, name: 'Nobody Special', kind: 'player' as const, leagueValue: null }],
})

describe('legacy views of a receipt', () => {
  it('maps every label onto the legacy verdict, side A being the graded side', () => {
    expect(legacyVerdictFromGrade(A_GRADE)).toBe('Strongly favors A')
    const even = gradeTrade({ ...base(), giveValue: 5000, getValue: 5100 })
    expect(legacyVerdictFromGrade(even)).toBe('Fair')
    const slightB = gradeTrade({ ...base(), giveValue: 5000, getValue: 4400 })
    expect(legacyVerdictFromGrade(slightB)).toBe('Slightly favors B')
    expect(legacyVerdictFromGrade(WITHHELD)).toBeNull()
  })

  it('builds the old balance from the receipt: A receives `get`, and nothing is re-priced', () => {
    const b = legacyBalanceFromReceipt(receiptOf(A_GRADE))!
    expect(b).toMatchObject({ sideAValue: 6000, sideBValue: 4000, difference: 2000, percentDiff: 33, verdict: 'Strongly favors A', unknownPlayers: [] })
    expect(b.breakdown.sideA.players).toEqual([{ name: 'Bravo', value: 3500, found: true }])
    expect(b.breakdown.sideA.picks).toEqual([{ desc: '2027 Round 1', value: 2500 }])
    expect(b.breakdown.sideB.players).toEqual([{ name: 'Alpha', value: 4000, found: true }])
  })

  it('a withheld grade has NO balance — never one built from placeholder values', () => {
    expect(legacyBalanceFromReceipt(receiptOf(WITHHELD))).toBeNull()
  })

  it('grade fields: the letter and its mirror, or null and the reason', () => {
    expect(receiptGradeFields(receiptOf(A_GRADE))).toMatchObject({ grade: 'A', partnerGrade: 'F', gradeWithheld: null, gradeSource: 'one_trade_engine', evaluationReceiptId: 'rcpt_1' })
    expect(receiptGradeFields(receiptOf(WITHHELD))).toMatchObject({ grade: null, partnerGrade: null, gradeWithheld: 'Nobody Special could not be found.' })
  })

  it('the prompt block states the grade, or forbids one — and never offers a default value', () => {
    const graded = receiptPromptBlock(receiptOf(A_GRADE))
    expect(graded).toContain('grade=A for Team A')
    expect(graded).toContain('Bravo: 3500 league value')
    const withheld = receiptPromptBlock(receiptOf(WITHHELD))
    expect(withheld).toContain('NOT graded: Nobody Special could not be found.')
    expect(withheld).toMatch(/Do not assign a letter grade/)
    expect(withheld).not.toMatch(/\b200\b/)
  })
})

describe('gradeInputsFromLegacyAssets', () => {
  it('turns players, picks and FAAB into engine input, tiering a pick by its number', () => {
    const g = gradeInputsFromLegacyAssets(
      [
        { type: 'player', player: { name: ' Bijan Robinson ' } },
        { type: 'pick', pick: { year: 2027, round: 1, pickNumber: 2 } },
        { type: 'pick', pick: { year: 2027, round: 2, pickNumber: 11 } },
        { type: 'pick', pick: { year: 2028, round: 3 } },
        { type: 'faab', faab: { amount: 25 } },
      ],
      12,
    )
    expect(g.assets).toEqual([
      { kind: 'player', name: 'Bijan Robinson' },
      { kind: 'pick', year: 2027, round: 1, tier: 'early' },
      { kind: 'pick', year: 2027, round: 2, tier: 'late' },
      { kind: 'pick', year: 2028, round: 3 },
      { kind: 'faab', amount: 25 },
    ])
    expect(g.unpriceable).toEqual([])
  })

  it('an asset it cannot read is a named reason, not a dropped asset', () => {
    const g = gradeInputsFromLegacyAssets(
      [
        { type: 'player', player: { name: '  ' } },
        { type: 'pick', pick: { year: 2027, round: null } },
      ],
      12,
    )
    expect(g.assets).toEqual([])
    expect(g.unpriceable).toEqual(['a player with no name', 'a draft pick with no year or round'])
  })
})

describe('resolveEvaluationLeagueId — only a league the viewer belongs to', () => {
  /*
   * mockClear, not mockReset: after a mockReset, vitest's own result tracking leaves a rejected
   * promise from the mock unhandled and reports it as the test's error — even though the resolver
   * catches it (verified: the call resolves null). An explicit default keeps each test independent.
   */
  beforeEach(() => {
    findMany.mockClear()
    findMany.mockImplementation(async () => [])
  })

  it('no viewer, or no id: no league, and no query', async () => {
    expect(await resolveEvaluationLeagueId({ suppliedLeagueId: 'x', userId: null })).toBeNull()
    expect(await resolveEvaluationLeagueId({ suppliedLeagueId: '  ', userId: 'u1' })).toBeNull()
    expect(findMany).not.toHaveBeenCalled()
  })

  it('matches an AF id OR a Sleeper id, and ONLY rows the viewer owns or has claimed a team in', async () => {
    findMany.mockResolvedValue([])
    expect(await resolveEvaluationLeagueId({ suppliedLeagueId: 'sl_123', userId: 'u1' })).toBeNull()
    const where = findMany.mock.calls[0]![0].where
    expect(where.AND).toEqual([
      { OR: [{ id: 'sl_123' }, { platformLeagueId: 'sl_123' }] },
      { OR: [{ userId: 'u1' }, { teams: { some: { claimedByUserId: 'u1' } } }] },
    ])
  })

  it("prefers an exact AF id, then the viewer's own import over another importer's row", async () => {
    findMany.mockResolvedValue([
      { id: 'af_other', userId: 'u2' },
      { id: 'af_mine', userId: 'u1' },
    ])
    expect(await resolveEvaluationLeagueId({ suppliedLeagueId: 'sl_123', userId: 'u1' })).toBe('af_mine')
    expect(await resolveEvaluationLeagueId({ suppliedLeagueId: 'af_other', userId: 'u1' })).toBe('af_other')
  })

  it('a database error is no league, never a thrown request', async () => {
    findMany.mockImplementation(() => Promise.reject(new Error('down')))
    expect(await resolveEvaluationLeagueId({ suppliedLeagueId: 'sl_1', userId: 'u1' })).toBeNull()
  })
})

function base() {
  return {
    giveValue: 0,
    getValue: 0,
    giveMarket: 0,
    getMarket: 0,
    unpriced: 0,
    giveCount: 1,
    getCount: 1,
    basis: 'b',
    scoringApplied: false,
    needApplied: false,
    needGap: null,
    lines: [],
    moves: [],
  }
}
