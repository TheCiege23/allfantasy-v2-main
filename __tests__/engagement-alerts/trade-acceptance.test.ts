import { describe, expect, it } from 'vitest'
import { acceptedTradeGradeText } from '@/lib/engagement-alerts/tradeAcceptance'
describe('accepted trade grade content', () => {
  it('includes frozen grades when both participants have complete evidence', () => {
    expect(acceptedTradeGradeText({ evaluatorSupported: true, participants: [{ grade: 'A-', coverageStatus: 'complete' }, { grade: 'B+', coverageStatus: 'complete' }] })).toBe('Initial market grades: A- / B+.')
  })
  it('does not invent or present an incomplete grade as valid', () => {
    expect(acceptedTradeGradeText(null)).toContain('unavailable')
    expect(acceptedTradeGradeText({ evaluatorSupported: true, participants: [{ grade: 'A', coverageStatus: 'partial' }] })).toContain('incomplete')
  })
})
