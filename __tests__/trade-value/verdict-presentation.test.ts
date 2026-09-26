import { describe, expect, it } from 'vitest'
import { presentTradeConsoleVerdict } from '@/lib/trade-value-console/verdictPresentation'

describe('proposal verdict presentation', () => {
  const input = { fairnessScore: 100, confidenceScore: 72, fairnessLabel: 'Even', sideAdvantage: 'even' as const, confidenceLabel: 'MEDIUM' }
  it.each([50, 100])('a withheld grade cannot expose a neutral or perfect-looking score (%s)', (fairnessScore) => {
    expect(presentTradeConsoleVerdict({ ...input, fairnessScore, graded: false })).toEqual({
      fairnessScore: null, confidenceScore: null,
      labels: { fairnessLabel: 'Grade unavailable', sideAdvantage: null, confidenceLabel: 'INSUFFICIENT' },
    })
  })
  it('retains an authoritative priced verdict rather than suppressing it for unrelated context gaps', () => {
    expect(presentTradeConsoleVerdict({ ...input, fairnessScore: 49, graded: true })).toEqual({
      fairnessScore: 49, confidenceScore: 72,
      labels: { fairnessLabel: 'Even', sideAdvantage: 'even', confidenceLabel: 'MEDIUM' },
    })
  })
})
