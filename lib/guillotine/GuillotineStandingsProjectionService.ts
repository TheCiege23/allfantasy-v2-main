/**
 * Survival standings and projected rankings for guillotine (active rosters only).
 */

import { prisma } from '@/lib/prisma'
import type { GuillotineSurvivalStanding } from './types'
import { resolveRosterDisplayNames } from './rosterDisplayNames'

export interface GetSurvivalStandingsInput {
  leagueId: string
  throughWeekOrPeriod?: number
}

/**
 * Return survival standings: active (non-chopped) rosters ranked by season points (and optional period points).
 */
export async function getSurvivalStandings(
  input: GetSurvivalStandingsInput
): Promise<GuillotineSurvivalStanding[]> {
  const { leagueId, throughWeekOrPeriod } = input
  const chopped = await prisma.guillotineRosterState.findMany({
    where: { leagueId, choppedAt: { not: null } },
    select: { rosterId: true },
  })
  const choppedSet = new Set(chopped.map((c) => c.rosterId))

  const scores = await prisma.guillotinePeriodScore.findMany({
    where: {
      leagueId,
      ...(throughWeekOrPeriod != null ? { weekOrPeriod: { lte: throughWeekOrPeriod } } : {}),
    },
    select: { rosterId: true, weekOrPeriod: true, periodPoints: true, seasonPointsCumul: true },
    orderBy: { weekOrPeriod: 'desc' },
  })

  const filtered = scores.filter(
    (s) => !choppedSet.has(s.rosterId) && (throughWeekOrPeriod == null || s.weekOrPeriod <= throughWeekOrPeriod)
  )
  const bestByRoster = new Map<string, typeof scores[0]>()
  for (const s of filtered) {
    const cur = bestByRoster.get(s.rosterId)
    if (!cur || s.weekOrPeriod > cur.weekOrPeriod) bestByRoster.set(s.rosterId, s)
  }
  const byRoster = new Map(
    [...bestByRoster.entries()].map(([id, row]) => [
      id,
      { seasonPointsCumul: row.seasonPointsCumul, periodPoints: row.periodPoints },
    ])
  )

  // Never email: these names render on the guillotine home and go into Chimmy's prompts. See rosterDisplayNames.ts.
  const nameByRoster = await resolveRosterDisplayNames(leagueId, [...byRoster.keys()])

  const list = [...byRoster.entries()]
    .map(([rosterId, data]) => ({
      rosterId,
      displayName: nameByRoster.get(rosterId),
      ...data,
    }))
    .sort((a, b) => b.seasonPointsCumul - a.seasonPointsCumul)

  return list.map((row, i) => ({
    rosterId: row.rosterId,
    displayName: row.displayName,
    rank: i + 1,
    seasonPointsCumul: row.seasonPointsCumul,
    periodPoints: row.periodPoints,
    isChopped: false as const,
  }))
}
