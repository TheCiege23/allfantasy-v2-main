/**
 * ForecastConfidenceScorer
 *
 * Assigns a 0-100 confidence score per team (or globally) based on:
 * - number of simulations
 * - data quality (e.g. weekly points sample size)
 * - variance in projected outcomes
 */

interface ConfidenceInput {
  simulationCount: number
  /** Number of weeks of actual data used for projections (e.g. weekly points length) */
  dataWeeksUsed: number
  totalWeeksInSeason: number
  /** Optional: per-team variance in simulated finish (e.g. std of seed over sims) */
  seedVarianceByTeam?: Map<string, number>
}

const MIN_SIM_FOR_HIGH = 2000
const MIN_SIM_FOR_MED = 500
const MIN_DATA_RATIO_HIGH = 0.4
const MIN_DATA_RATIO_MED = 0.15

/**
 * Returns a 0-100 confidence score for the forecast run.
 */
export function scoreForecastConfidence(input: ConfidenceInput): number {
  const { simulationCount, dataWeeksUsed, totalWeeksInSeason } = input
  const dataRatio = totalWeeksInSeason > 0 ? dataWeeksUsed / totalWeeksInSeason : 0

  let simScore = 0
  if (simulationCount >= MIN_SIM_FOR_HIGH) simScore = 100
  else if (simulationCount >= MIN_SIM_FOR_MED) simScore = 60 + (40 * (simulationCount - MIN_SIM_FOR_MED)) / (MIN_SIM_FOR_HIGH - MIN_SIM_FOR_MED)
  else simScore = Math.min(60, (simulationCount / MIN_SIM_FOR_MED) * 60)

  let dataScore = 0
  if (dataRatio >= MIN_DATA_RATIO_HIGH) dataScore = 100
  else if (dataRatio >= MIN_DATA_RATIO_MED) dataScore = 50 + (50 * (dataRatio - MIN_DATA_RATIO_MED)) / (MIN_DATA_RATIO_HIGH - MIN_DATA_RATIO_MED)
  else dataScore = Math.min(50, (dataRatio / MIN_DATA_RATIO_MED) * 50)

  const combined = Math.round(0.6 * simScore + 0.4 * dataScore)
  return Math.min(100, Math.max(0, combined))
}

/**
 * Per-team confidence: can down-rank if this team has very high variance in outcomes.
 */
export function scoreTeamConfidence(
  baseConfidence: number,
  seedVariance?: number
): number {
  if (seedVariance == null || seedVariance <= 1) return baseConfidence
  const variancePenalty = Math.min(20, seedVariance * 2)
  return Math.max(0, Math.round(baseConfidence - variancePenalty))
}
