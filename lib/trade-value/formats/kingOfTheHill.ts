import type { FormatValueModel } from './types'

const object = (v: unknown): Record<string, unknown> | null =>
  v != null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
const probability = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null

export const kingOfTheHillModel: FormatValueModel = {
  formatId: 'king_of_the_hill', label: 'King of the Hill',
  adjust(input) {
    const giver = object(input.teamState)
    const asset = object(input.assetState)
    if (giver?.viewerIsKing !== true) return { multiplier: 1, reason: 'This roster does not hold the crown, so the three-player dethroning penalty does not currently expose this asset.' }
    const lose = probability(giver.weeklyLossProbability)
    const topThree = probability(asset?.topThreeScorerProbability)
    if (lose == null || topThree == null) return null
    const lossRisk = lose * topThree
    return {
      multiplier: 1 - lossRisk,
      reason: `As the current King, this roster has a ${(lossRisk * 100).toFixed(1)}% modeled chance of losing this player through the rule that sends that week's top three scorers to waivers after a loss.`,
    }
  },
  canTrade(input) {
    const state = object(input.teamState)
    const playoffStart = typeof state?.playoffStartWeek === 'number' ? state.playoffStartWeek : null
    if (playoffStart != null && input.currentWeek != null && input.currentWeek >= playoffStart) return { ok: false, reason: `King of the Hill ends when playoffs start in week ${playoffStart}.` }
    const deadline = input.shape.deadlineWeek
    if (deadline != null && input.currentWeek != null && input.currentWeek > deadline) return { ok: false, reason: `Trades closed after week ${deadline}.` }
    return { ok: true }
  },
}
