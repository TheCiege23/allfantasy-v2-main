/**
 * SimulationResultRenderer — maps API result to display props for the matchup simulator card.
 * Pure helpers; actual UI lives in MatchupSimulationCard.
 */

import type { MatchupSimulationResult } from '@/components/simulation/MatchupSimulationCard'
import { getDisplayPayload } from './MatchupSimulatorViewService'

type SimulationDisplayProps = {
  projectedScoreA: number
  projectedScoreB: number
  scoreRangeA: [number, number]
  scoreRangeB: [number, number]
  winProbA: number
  winProbB: number
  marginMean: number
  marginStdDev: number
  volatilityTag: 'low' | 'medium' | 'high'
  upsetChance: number
  iterations: number | null
}

/**
 * Map API result to display props for rendering (win prob as 0–100, ranges, etc.).
 */
export function resultToDisplayProps(result: MatchupSimulationResult): SimulationDisplayProps {
  const p = getDisplayPayload(result)
  return {
    projectedScoreA: p.projA,
    projectedScoreB: p.projB,
    scoreRangeA: p.rangeA,
    scoreRangeB: p.rangeB,
    winProbA: p.probA,
    winProbB: p.probB,
    marginMean: result.marginMean,
    marginStdDev: result.marginStdDev,
    volatilityTag: p.vol,
    upsetChance: p.upsetChance,
    iterations: p.iterations,
  }
}
