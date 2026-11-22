/**
 * TeamComparisonResolver — team A/B labels and comparison summary (strengths/weaknesses).
 * Used for headers, tooltips, and AI context.
 */

import type { MatchupSimulationResult } from '@/components/simulation/MatchupSimulationCard'

type ComparisonSummary = {
  favoredName: string
  underdogName: string
  favoredProb: number
  underdogProb: number
  strengthSummary: string
  weaknessSummary: string
  strengthBullets: string[]
  weaknessBullets: string[]
}

/**
 * Resolve which team is favored and underdog from result; build short strength/weakness copy.
 */
export function resolveComparisonSummary(
  teamAName: string,
  teamBName: string,
  result: MatchupSimulationResult
): ComparisonSummary {
  const probA = result.winProbabilityA * 100
  const probB = result.winProbabilityB * 100
  const favoredA = probA >= probB
  const favoredName = favoredA ? teamAName : teamBName
  const underdogName = favoredA ? teamBName : teamAName
  const favoredProb = favoredA ? probA : probB
  const underdogProb = favoredA ? probB : probA

  const projA = result.projectedScoreA
  const projB = result.projectedScoreB
  const rangeAWidth = Math.max(0, result.scoreRangeA[1] - result.scoreRangeA[0])
  const rangeBWidth = Math.max(0, result.scoreRangeB[1] - result.scoreRangeB[0])
  const higherProj = projA >= projB ? teamAName : teamBName
  const lowerProj = projA >= projB ? teamBName : teamAName

  const strengthSummary = `${favoredName} is favored (${favoredProb.toFixed(0)}% win probability). Projected score: ${favoredName} ${Math.max(projA, projB).toFixed(1)} – ${Math.min(projA, projB).toFixed(1)} ${underdogName}.`
  const weaknessSummary =
    result.upsetChance > 5
      ? `Underdog ${underdogName} has ${result.upsetChance}% upset chance; volatility: ${result.volatilityTag}.`
      : `Score variance is ${result.volatilityTag}.`
  const strengthBullets = [
    `${higherProj} leads projection baseline (${Math.max(projA, projB).toFixed(1)} pts).`,
    `${favoredName} carries ${favoredProb.toFixed(0)}% win odds in current settings.`,
    result.upsetChance <= 15
      ? 'Upset risk is controlled in this simulation profile.'
      : 'Upset profile remains live, so depth and late-game variance matter.',
  ]
  const weaknessBullets = [
    `${lowerProj} trails projection baseline (${Math.min(projA, projB).toFixed(1)} pts).`,
    `${underdogName} only reaches ${underdogProb.toFixed(0)}% win odds without swing events.`,
    `Score spread volatility: ${teamAName} ${rangeAWidth.toFixed(1)} vs ${teamBName} ${rangeBWidth.toFixed(1)}.`,
  ]

  return {
    favoredName,
    underdogName,
    favoredProb,
    underdogProb,
    strengthSummary,
    weaknessSummary,
    strengthBullets,
    weaknessBullets,
  }
}
