import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * A logged TRADE decision shows the deal's one trade grade beside its outcome grade, each labelled
 * (`lib/decision-log-trade-grade.ts`). The trade grade is the stamp the analyzer wrote from its
 * `evaluateTrade()` receipt; a row without that stamp shows no trade grade — never the old
 * `aiRecommendation.grade`, which held the AI's own letter before 2026-11-08.
 */

const findMany = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: { decisionLog: { findMany } } }))
vi.mock('@/lib/hybrid-valuation', () => ({ pricePlayer: vi.fn() }))
vi.mock('@/lib/sleeper-client', () => ({ getLeagueRosters: vi.fn(), getAllPlayers: vi.fn(), getLeagueInfo: vi.fn() }))
vi.mock('@/lib/values/leagueValuePatch', () => ({ resolveLeagueValuePatch: vi.fn() }))

import { getDecisionLogsForCoach, getDecisionSummary } from '@/lib/decision-log'
import {
  ONE_TRADE_GRADE_KEY,
  decisionGradeLine,
  decisionTradeGrade,
  oneTradeGradeStamp,
  withoutServerOnlyDecisionKeys,
} from '@/lib/decision-log-trade-grade'

const stamp = oneTradeGradeStamp({ receiptId: 'rcpt-1', evaluatedAt: '2026-11-01T00:00:00.000Z', grade: { graded: true, letter: 'B' } })
const row = (over: Record<string, unknown>) => ({
  id: 'd',
  userId: 'user1',
  leagueId: 'sl-1',
  decisionType: 'trade',
  aiRecommendation: { summary: 'Trade: fair' },
  confidenceScore: 0.7,
  riskProfile: 'moderate',
  userFollowed: true,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  outcome: { outcomeGrade: 'A', evaluationWeeks: 4, actualResult: 'positive', rosterValueDelta: 300 },
  ...over,
})

const LINKED = row({ id: 'linked', aiRecommendation: { summary: 'Trade: fair', grade: 'B', [ONE_TRADE_GRADE_KEY]: stamp } })
// Logged before the stamp: carries an `aiRecommendation.grade` of unknowable origin.
const UNLINKED = row({ id: 'unlinked', aiRecommendation: { summary: 'Trade: fair', grade: 'A+' } })
const WITHHELD = row({
  id: 'withheld',
  aiRecommendation: { [ONE_TRADE_GRADE_KEY]: oneTradeGradeStamp({ receiptId: null, grade: { graded: false, reason: 'No league is selected.' } }) },
  outcome: null,
})
const PROPOSALS = row({ id: 'proposals', decisionType: 'trade_proposal', aiRecommendation: { summary: 'Trade Proposals: 3 generated', [ONE_TRADE_GRADE_KEY]: stamp } })
const WAIVER = row({ id: 'waiver', decisionType: 'waiver', aiRecommendation: { summary: 'Waiver' } })

beforeEach(() => findMany.mockReset())

describe('the trade grade beside the outcome grade', () => {
  it('a stamped trade decision shows both, each labelled', () => {
    expect(decisionGradeLine(decisionTradeGrade(LINKED), LINKED.outcome)).toBe('Trade grade B · Outcome after 4 weeks: A')
  })

  it('an unstamped trade decision shows only the outcome — the old `grade` field is not read', () => {
    expect(decisionTradeGrade(UNLINKED)).toBeNull()
    expect(decisionGradeLine(decisionTradeGrade(UNLINKED), UNLINKED.outcome)).toBe('Outcome after 4 weeks: A')
  })

  it('a deal the grader withheld says so rather than inventing a letter', () => {
    expect(decisionGradeLine(decisionTradeGrade(WITHHELD), null)).toBe('Trade grade: not graded · Outcome: awaiting')
  })

  it('a proposal run (several packages) and a waiver never carry a trade grade', () => {
    expect(decisionTradeGrade(PROPOSALS)).toBeNull()
    expect(decisionTradeGrade(WAIVER)).toBeNull()
  })

  it('a stamp that does not name the one engine is not a trade grade', () => {
    expect(decisionTradeGrade(row({ aiRecommendation: { [ONE_TRADE_GRADE_KEY]: { ...stamp, source: 'ai' } } }))).toBeNull()
  })

  it('a client cannot write the stamp through POST', () => {
    expect(withoutServerOnlyDecisionKeys({ summary: 's', [ONE_TRADE_GRADE_KEY]: stamp })).toEqual({ summary: 's' })
  })
})

describe('getDecisionLogsForCoach / getDecisionSummary', () => {
  it('returns the trade grade for a linked row and none for an unlinked one; the outcome letter is unchanged', async () => {
    findMany.mockResolvedValue([LINKED, UNLINKED, WAIVER])
    const out = await getDecisionLogsForCoach('user1', 10)
    expect(out.map((d) => [d.tradeGrade, d.grade, d.gradeLine])).toEqual([
      ['B', 'A', 'Trade grade B · Outcome after 4 weeks: A'],
      [null, 'A', 'Outcome after 4 weeks: A'],
      [null, 'A', 'Outcome after 4 weeks: A'],
    ])
  })

  it('reports how many trade decisions could be linked', async () => {
    findMany.mockResolvedValue([LINKED, UNLINKED, WITHHELD, PROPOSALS, WAIVER])
    const s = await getDecisionSummary('user1')
    expect(s.tradeGradeCoverage).toEqual({ tradeDecisions: 4, linked: 2, graded: 1 })
  })
})

describe('the writer', () => {
  it('the legacy trade analyzer stamps its receipt’s grade on the decision it logs', () => {
    const src = readFileSync(resolve(process.cwd(), 'server/api-route-modules/legacy/trade/analyze/route.ts'), 'utf8')
    const block = src.slice(src.indexOf('autoLogDecision({'), src.indexOf('confidenceRisk: crResult,', src.indexOf('autoLogDecision({')))
    expect(block).toContain('[ONE_TRADE_GRADE_KEY]: oneTradeGradeStamp(evaluationReceipt)')
  })
})
