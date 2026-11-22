import { describe, expect, it } from 'vitest'
import { adjustedScore, adjustmentFor, formatAdjustment, parseAdjustmentInput, readScoreAdjustments, type ScoreAdjustment } from '@/lib/score-adjustments/scoreAdjustments'

const a = (over: Partial<ScoreAdjustment> = {}): ScoreAdjustment => ({ id: 'x', matchupId: 'm1', rosterId: 'r1', week: 3, points: 2, reason: 'fix', byUserId: 'u', at: 'now', ...over })

describe('score adjustments (pure)', () => {
  it('sums one team’s adjustments in one matchup only, to two decimals', () => {
    const list = [a({ points: 0.1 }), a({ id: 'y', points: 0.2 }), a({ id: 'z', rosterId: 'r2', points: 9 }), a({ id: 'w', matchupId: 'm2', points: 9 })]
    expect(adjustmentFor(list, 'm1', 'r1')).toBe(0.3)
    expect(adjustedScore(100, list, 'm1', 'r1')).toBe(100.3)
    expect(adjustedScore(100.123, [], 'm1', 'r1')).toBe(100.123)
  })

  it('drops unreadable stored entries instead of breaking a rescore', () => {
    expect(readScoreAdjustments({ commissioner_score_adjustments: [a(), { id: 'bad' }, null, 'x'] })).toEqual([a()])
    expect(readScoreAdjustments({ commissioner_score_adjustments: 'nope' })).toEqual([])
    expect(readScoreAdjustments(null)).toEqual([])
  })

  it('accepts a penalty or a bonus with a reason', () => {
    expect(parseAdjustmentInput({ matchupId: 'm', rosterId: 'r', points: -5, reason: '  started an empty slot  ' })).toEqual({ ok: true, value: { matchupId: 'm', rosterId: 'r', points: -5, reason: 'started an empty slot' } })
    expect(parseAdjustmentInput({ matchupId: 'm', rosterId: 'r', points: 2.25, reason: 'stat correction' })).toMatchObject({ ok: true })
  })

  it('refuses zero, oversized, over-precise and non-number points, a missing reason, and a missing target', () => {
    for (const points of [0, 501, -501, 1.234, '5', NaN, Infinity]) {
      expect(parseAdjustmentInput({ matchupId: 'm', rosterId: 'r', points, reason: 'ok reason' })).toEqual({ ok: false, error: 'bad_points' })
    }
    expect(parseAdjustmentInput({ matchupId: 'm', rosterId: 'r', points: 1, reason: ' a ' })).toEqual({ ok: false, error: 'bad_reason' })
    expect(parseAdjustmentInput({ matchupId: 'm', rosterId: 'r', points: 1, reason: 'x'.repeat(201) })).toEqual({ ok: false, error: 'bad_reason' })
    expect(parseAdjustmentInput({ rosterId: 'r', points: 1, reason: 'reason' })).toEqual({ ok: false, error: 'bad_target' })
  })

  it('formats with a sign', () => {
    expect(formatAdjustment(3.5)).toBe('+3.5')
    expect(formatAdjustment(-2)).toBe('−2')
  })
})
