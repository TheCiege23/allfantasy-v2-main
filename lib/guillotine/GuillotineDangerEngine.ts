/**
 * Danger engine: Chop Zone (lowest projected), Danger Tier (within margin), Safe Tier.
 * Live standings feed for guillotine view.
 */

import { prisma } from '@/lib/prisma'
import { getGuillotineConfig } from './GuillotineLeagueConfig'
import type { GuillotineDangerRow, DangerTier } from './types'
import { resolveRosterDisplayNames } from './rosterDisplayNames'

export interface GetDangerTiersInput {
  leagueId: string
  weekOrPeriod: number
  /** Projected points per roster for this period (rosterId -> points). If not provided, uses latest in-period score data as proxy. */
  projectedPointsByRoster?: Map<string, number>
  /** Override danger margin (points below lowest = danger). */
  dangerMarginPoints?: number | null
}

/**
 * Compute Chop Zone (lowest projected), Danger Tier (within margin of lowest), Safe Tier.
 */
export async function getDangerTiers(input: GetDangerTiersInput): Promise<GuillotineDangerRow[]> {
  const config = await getGuillotineConfig(input.leagueId)
  if (!config) return []

  const margin = input.dangerMarginPoints ?? config.dangerMarginPoints ?? 10
  const chopped = await prisma.guillotineRosterState.findMany({
    where: { leagueId: input.leagueId, choppedAt: { not: null } },
    select: { rosterId: true },
  })
  const choppedSet = new Set(chopped.map((c) => c.rosterId))

  let projectedByRoster = input.projectedPointsByRoster
  if (!projectedByRoster || projectedByRoster.size === 0) {
    const currentPeriodScores = await prisma.guillotinePeriodScore.findMany({
      where: { leagueId: input.leagueId, weekOrPeriod: input.weekOrPeriod },
      select: { rosterId: true, periodPoints: true },
    })

    if (currentPeriodScores.length > 0) {
      projectedByRoster = new Map(
        currentPeriodScores
          .filter((s) => !choppedSet.has(s.rosterId))
          .map((s) => [s.rosterId, s.periodPoints])
      )
    }
  }

  if (!projectedByRoster || projectedByRoster.size === 0) {
    const fallbackScores = await prisma.guillotinePeriodScore.findMany({
      where: { leagueId: input.leagueId, weekOrPeriod: Math.max(1, input.weekOrPeriod - 1) },
      select: { rosterId: true, seasonPointsCumul: true },
    })
    projectedByRoster = new Map(
      fallbackScores
        .filter((s) => !choppedSet.has(s.rosterId))
        .map((s) => [s.rosterId, s.seasonPointsCumul])
    )
  }

  const active = [...projectedByRoster.entries()].filter(([id]) => !choppedSet.has(id))
  if (active.length === 0) return []

  const sorted = [...active].sort((a, b) => a[1] - b[1])
  const minProjected = sorted[0]?.[1] ?? 0
  const dangerThreshold = minProjected + margin
  const bubbleCount = Math.min(4, sorted.length)

  /*
   * 🛑 NEVER EMAIL. These names render on the guillotine home, go into Chimmy's prompts, and are
   * read by every other manager in the league. This block used to resolve `displayName || email`.
   * See rosterDisplayNames.ts.
   */
  const nameByRoster = await resolveRosterDisplayNames(
    input.leagueId,
    sorted.map(([id]) => id),
  )

  const periodScores = await prisma.guillotinePeriodScore.findMany({
    where: { leagueId: input.leagueId, weekOrPeriod: input.weekOrPeriod },
    select: { rosterId: true, seasonPointsCumul: true },
  })
  const seasonByRoster = new Map(periodScores.map((s) => [s.rosterId, s.seasonPointsCumul]))

  const result: GuillotineDangerRow[] = sorted.map(([rosterId, projectedPoints], i) => {
    const tier: DangerTier =
      i === 0 ? 'chop_zone' : i < bubbleCount || projectedPoints <= dangerThreshold ? 'danger' : 'safe'
    return {
      rosterId,
      displayName: nameByRoster.get(rosterId),
      projectedPoints,
      seasonPointsCumul: seasonByRoster.get(rosterId) ?? 0,
      tier,
      rank: i + 1,
      pointsFromChopZone: projectedPoints - minProjected,
    }
  })

  return result
}
