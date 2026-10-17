import 'server-only'

import { prisma } from '@/lib/prisma'
import { weekFinished } from './matchupGameState'
import { finishedWeekKey, type FinishedNflWeeks } from './finishedNflWeeks.types'

export { finishedWeekKey, type FinishedNflWeeks }

/**
 * Which of these NFL weeks has the schedule fully played? See `weekFinished` for the rule and the
 * measurement behind it.
 *
 * One read for every (season, week) asked about — callers pass the weeks their leagues are ON,
 * which is one or two numbers for a whole account. Any failure returns the empty set: "not known
 * to be finished", never a guess that a week is over.
 */
export async function loadFinishedNflWeeks(
  weeks: ReadonlyArray<{ season: number; week: number }>,
): Promise<FinishedNflWeeks> {
  const wanted = new Map<string, { season: number; week: number }>()
  for (const w of weeks) {
    if (Number.isInteger(w.season) && Number.isInteger(w.week) && w.week > 0) wanted.set(finishedWeekKey(w.season, w.week), w)
  }
  if (wanted.size === 0) return new Set()
  try {
    const games = await prisma.sportsGame.findMany({
      where: {
        sport: 'NFL',
        OR: [...wanted.values()].map((w) => ({ season: w.season, week: w.week })),
        AND: [{ OR: [{ seasonType: 'regular' }, { seasonType: null }] }],
      },
      select: { season: true, week: true, homeTeam: true, awayTeam: true, status: true, startTime: true, fetchedAt: true, seasonType: true },
      take: 2000,
    })
    const byWeek = new Map<string, typeof games>()
    for (const g of games) {
      if (g.season == null || g.week == null) continue
      const k = finishedWeekKey(g.season, g.week)
      const list = byWeek.get(k)
      if (list) list.push(g)
      else byWeek.set(k, [g])
    }
    const finished = new Set<string>()
    for (const [k, list] of byWeek) if (weekFinished(list)) finished.add(k)
    return finished
  } catch {
    return new Set()
  }
}
