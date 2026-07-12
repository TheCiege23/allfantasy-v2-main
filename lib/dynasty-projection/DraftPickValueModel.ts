import { getPickValue } from '@/lib/player-valuations/canonicalPlayerValuations'
import type { DynastyLeagueContext, DraftPickValueBreakdown, FuturePickAsset } from './types'

export function valueFuturePicks(
  picks: FuturePickAsset[],
  ctx: DynastyLeagueContext,
): DraftPickValueBreakdown {
  if (!picks.length) {
    return {
      totalDynastyValue: 0,
      nearTermContribution: 0,
      longTermContribution: 0,
    }
  }

  const currentYear = ctx.season
  let total = 0
  let near = 0
  let long = 0

  for (const p of picks) {
    const base = getPickValue(p.season, p.round, ctx.isDynasty, p.pickNumber, ctx.teamCount)
    const yearsOut = Math.max(0, p.season - currentYear)

    total += base
    if (yearsOut <= 2) {
      near += base
    } else {
      long += base
    }
  }

  return {
    totalDynastyValue: Math.round(total),
    nearTermContribution: Math.round(near),
    longTermContribution: Math.round(long),
  }
}

