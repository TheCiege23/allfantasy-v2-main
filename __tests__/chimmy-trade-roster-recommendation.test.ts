import { describe, it, expect } from 'vitest'
import { tradeDecisionRecommendation, tradeFutureStructure } from '@/lib/chimmy/tradeDecisionRecommendation'
import type { ReadyTradeScenario } from '@/lib/chimmy/tradeScenarioTypes'
const base = { recommendation: { action: 'accept', explanation: 'Favors you on league value.' }, lineup: { before: 150, after: 130, delta: -20, unit: 'league_points_week' }, lineupWeek: 3, depthChanges: [{ position: 'LB', before: 4, after: 2 }], give: [], get: [{ playerId: 'pick:2027:1:other', name: '2027 1st', position: null }] } as unknown as ReadyTradeScenario

describe('trade recommendation respects current competitive roster', () => {
  it('counters a favorable value deal that harms the lineup', () => {
    expect(tradeDecisionRecommendation(base)).toContain('COUNTER:')
    expect(tradeDecisionRecommendation(base)).toContain('20.0 points')
    expect(tradeDecisionRecommendation(base)).toContain('at LB')
  })
  it('withholds acceptance when lineup evidence is missing', () => {
    expect(tradeDecisionRecommendation({ ...base, lineup: null })).toContain('COUNTER / HOLD')
  })
  it('gives conditional yes when both observed value and lineup fit support it', () => {
    expect(tradeDecisionRecommendation({ ...base, lineup: { ...base.lineup!, delta: 10 } })).toContain('YES,')
  })
  it('keeps an engine decline even when the lineup improves', () => {
    expect(tradeDecisionRecommendation({ ...base, recommendation: { action: 'decline', explanation: 'Overpay' } })).toBe('NO: Overpay')
  })
  it('distinguishes future pick flexibility from a current replacement', () => {
    expect(tradeFutureStructure(base).join(' ')).toContain("cannot replace today's lost starter")
  })
})
