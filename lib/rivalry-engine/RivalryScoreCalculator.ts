/**
 * RivalryScoreCalculator — computes a 0–100 rivalry score from H2H, playoff, trade, and drama inputs.
 */

import type { RivalryScoreInput } from './types'

interface RivalryScoreWeights {
  totalMatchups: number
  closeGameFrequency: number
  playoffMeetings: number
  eliminationEvents: number
  championshipMeetings: number
  upsetFactor: number
  tradeFrequency: number
  contentionOverlap: number
  dramaEvents: number
}

const DEFAULT_WEIGHTS: RivalryScoreWeights = {
  totalMatchups: 0.15,
  closeGameFrequency: 0.20,
  playoffMeetings: 0.15,
  eliminationEvents: 0.12,
  championshipMeetings: 0.15,
  upsetFactor: 0.08,
  tradeFrequency: 0.10,
  contentionOverlap: 0.03,
  dramaEvents: 0.02,
}

/**
 * Compute composite rivalry score 0–100 from aggregated inputs.
 * Each factor is normalized and weighted; then capped at 100.
 */
export function calculateRivalryScore(
  input: RivalryScoreInput,
  weights: Partial<RivalryScoreWeights> = {}
): number {
  const w = { ...DEFAULT_WEIGHTS, ...weights }

  const totalMatchupsNorm = Math.min(input.totalMatchups / 15, 1) * 100
  const closeFreq =
    input.totalMatchups > 0
      ? Math.min((input.closeGameCount / input.totalMatchups) * 100, 100)
      : 0
  const playoffNorm = Math.min(input.playoffMeetings * 25, 100)
  const eliminationNorm = Math.min(input.eliminationEvents * 20, 100)
  const championshipNorm = Math.min(input.championshipMeetings * 50, 100)
  const upsetNorm = Math.min(input.upsetWins * 15, 100)
  const tradeNorm = Math.min(input.tradeCount * 12, 100)
  const contentionNorm = Math.min(input.contentionOverlapScore, 100)
  const dramaNorm = Math.min(input.dramaEventCount * 20, 100)

  const raw =
    totalMatchupsNorm * w.totalMatchups +
    closeFreq * w.closeGameFrequency +
    playoffNorm * w.playoffMeetings +
    eliminationNorm * w.eliminationEvents +
    championshipNorm * w.championshipMeetings +
    upsetNorm * w.upsetFactor +
    tradeNorm * w.tradeFrequency +
    contentionNorm * w.contentionOverlap +
    dramaNorm * w.dramaEvents

  return Math.max(0, Math.min(100, Math.round(raw * 10) / 10))
}
