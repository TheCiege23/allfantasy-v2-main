/** Presentation fields must never turn a withheld shared grade into an opinion. */
export function presentTradeConsoleVerdict(input: {
  graded: boolean
  fairnessScore: number
  confidenceScore: number
  fairnessLabel: string
  sideAdvantage: 'even' | 'you' | 'opponent' | 'mixed'
  confidenceLabel: string
}) {
  return {
    fairnessScore: input.graded ? input.fairnessScore : null,
    confidenceScore: input.graded ? input.confidenceScore : null,
    labels: {
      fairnessLabel: input.graded ? input.fairnessLabel : 'Grade unavailable',
      sideAdvantage: input.graded ? input.sideAdvantage : null,
      confidenceLabel: input.graded ? input.confidenceLabel : 'INSUFFICIENT',
    },
  }
}
