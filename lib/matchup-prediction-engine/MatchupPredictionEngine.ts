import { getDefaultScoreStdDev } from '@/lib/simulation-engine/SportSimulationResolver'
import { normalizeSportForSimulation } from '@/lib/simulation-engine/types'
import type {
  MatchupPredictionEngineInput,
  MatchupPredictionEngineOutput,
  MatchupPredictionScoringRulesInput,
} from './types'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10
}

function roundToThousandth(value: number): number {
  return Math.round(value * 1000) / 1000
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1
  const x = Math.abs(value)
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911
  const t = 1 / (1 + p * x)
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x)
  return sign * y
}

function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.sqrt(2)))
}

function resolvePresetRules(
  preset: MatchupPredictionScoringRulesInput['preset']
): Required<Pick<MatchupPredictionScoringRulesInput, 'pointMultiplier' | 'varianceMultiplier'>> {
  if (preset === 'aggressive') {
    return { pointMultiplier: 1.08, varianceMultiplier: 1.12 }
  }
  if (preset === 'conservative') {
    return { pointMultiplier: 0.94, varianceMultiplier: 0.9 }
  }
  return { pointMultiplier: 1, varianceMultiplier: 1 }
}

function normalizeRules(rules?: MatchupPredictionScoringRulesInput): Required<MatchupPredictionScoringRulesInput> {
  const preset = rules?.preset ?? 'standard'
  const presetRules = resolvePresetRules(preset)
  return {
    preset,
    pointMultiplier: clamp(
      Number(rules?.pointMultiplier ?? presetRules.pointMultiplier),
      0.7,
      1.4
    ),
    teamABonus: clamp(Number(rules?.teamABonus ?? 0), -25, 25),
    teamBBonus: clamp(Number(rules?.teamBBonus ?? 0), -25, 25),
    varianceMultiplier: clamp(
      Number(rules?.varianceMultiplier ?? presetRules.varianceMultiplier),
      0.65,
      1.8
    ),
  }
}

function resolveConfidenceBand(spreadStdDev: number): MatchupPredictionEngineOutput['confidenceBand'] {
  if (spreadStdDev <= 10) return 'tight'
  if (spreadStdDev >= 20) return 'wide'
  return 'normal'
}

/**
 * Deterministic matchup prediction using projections + scoring rules.
 * AI can explain this output, but never replaces these calculations.
 */
export function predictMatchupDeterministic(
  input: MatchupPredictionEngineInput
): MatchupPredictionEngineOutput {
  const sport = normalizeSportForSimulation(input.sport)
  const rules = normalizeRules(input.scoringRules)
  const baseA = Math.max(0, Number(input.projectedScoreA ?? 0))
  const baseB = Math.max(0, Number(input.projectedScoreB ?? 0))
  const stdDevA = Math.max(1, Number(input.stdDevA ?? getDefaultScoreStdDev(sport)))
  const stdDevB = Math.max(1, Number(input.stdDevB ?? getDefaultScoreStdDev(sport)))

  const projectedScoreA = Math.max(0, baseA * rules.pointMultiplier + rules.teamABonus)
  const projectedScoreB = Math.max(0, baseB * rules.pointMultiplier + rules.teamBBonus)
  const spreadStdDev = Math.max(
    1,
    Math.sqrt(stdDevA * stdDevA + stdDevB * stdDevB) * rules.varianceMultiplier
  )
  const zScore = (projectedScoreA - projectedScoreB) / spreadStdDev
  const winProbabilityA = clamp(normalCdf(zScore), 0.01, 0.99)
  const winProbabilityB = 1 - winProbabilityA

  return {
    projectedScoreA: roundToTenth(projectedScoreA),
    projectedScoreB: roundToTenth(projectedScoreB),
    winProbabilityA: roundToThousandth(winProbabilityA),
    winProbabilityB: roundToThousandth(winProbabilityB),
    confidenceBand: resolveConfidenceBand(spreadStdDev),
    appliedRules: rules,
  }
}
