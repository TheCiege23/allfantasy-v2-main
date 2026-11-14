/**
 * DynastyValueModel — wraps existing dynasty value logic (roster + picks).
 * Re-exports from dynasty-projection for unified engine.
 */

export type { RosterFutureValueBreakdown, DraftPickValueBreakdown } from '@/lib/dynasty-projection/types'

/**
 * Normalize pick value into a 0–100 future asset score for the projection output.
 */
export function futureAssetScoreFromPicks(
  pickBreakdown: { totalDynastyValue: number; nearTermContribution: number; longTermContribution: number },
  leagueSize: number
): number {
  const perTeam = leagueSize > 0 ? pickBreakdown.totalDynastyValue / leagueSize : pickBreakdown.totalDynastyValue
  return Math.round(Math.min(100, Math.max(0, perTeam / 120)))
}
