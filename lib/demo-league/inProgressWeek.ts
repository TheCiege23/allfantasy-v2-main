import 'server-only'

import { prisma } from '@/lib/prisma'
import { finishedWeekKey, loadFinishedNflWeeks } from '@/lib/core-app/finishedNflWeeks'
import { lastScoredWeek, type WeekRowLike } from './weekProgress'

export type InProgressWeekDeps = {
  /** Is every regular-season game of that NFL week final? (`weekFinished`, from SportsGame.) */
  weekFinal: (season: number, week: number) => Promise<boolean>
  /** How many regular-season games the schedule holds for that week — 0 means we cannot tell. */
  regularGames: (season: number, week: number) => Promise<number>
}

const defaultDeps: InProgressWeekDeps = {
  weekFinal: async (season, week) => (await loadFinishedNflWeeks([{ season, week }])).has(finishedWeekKey(season, week)),
  regularGames: (season, week) =>
    prisma.sportsGame.count({ where: { sport: 'NFL', season, week, seasonType: 'regular' } }).catch(() => 0),
}

/**
 * The week the NFL schedule says is still being played, when it is the league's latest scored week
 * (see `weekProgress.ts` for why that week can look finished). DB-only: reads `SportsGame`, which
 * the score crons keep current, never a provider.
 *
 * Null — nothing to hold back — when the league is not NFL, nothing is scored yet, every game of
 * that week is final, or the schedule has NO regular-season games for it. That last case is
 * "unknown", and unknown must not freeze the demo a week behind forever, so it falls back to the
 * scores rule. A failed read lands there too (the loader returns "not finished" on error, and the
 * count returns 0).
 */
export async function findInProgressNflWeek(
  sport: string,
  season: number | null,
  weekRows: readonly WeekRowLike[],
  deps: InProgressWeekDeps = defaultDeps,
): Promise<number | null> {
  if (sport.toUpperCase() !== 'NFL' || season == null) return null
  const week = lastScoredWeek(weekRows)
  if (week == null) return null
  if (await deps.weekFinal(season, week)) return null
  if ((await deps.regularGames(season, week)) === 0) return null
  return week
}
