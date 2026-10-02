import 'server-only'

import { prisma } from '@/lib/prisma'
import { isRuledOut } from './injuryStatus'
import { namesBySleeperId, readInjuryStatusById } from './injuryStatusById'
import { composePlayerIdentities } from './playerIdentityCompose'
import { getByeWeeks } from './byeWeeks'

/**
 * Who among these Sleeper ids is certain to score nothing in one week — ruled out, or his club is
 * off — grouped by sport.
 *
 * One identity read for every id, then one availability read per sport: the batched form for a
 * screen that covers many leagues at once. The one-league screen reads the same two sources through
 * `loadSideProjections`, with the same `isRuledOut` rule, so the two cannot disagree about who is
 * playing. Moved here from the rail so the all-leagues matchup board could apply it too — it counted
 * a ruled-out starter at full value while the league page beside it counted him as zero.
 *
 * ⚠ ONLY FOR THE WEEK BEING PLAYED. A current injury says nothing about a fallback projection
 * borrowed from another week, so callers must not apply this to one.
 */
export async function loadUnavailableBySport(args: {
  sleeperIds: readonly string[]
  sports: readonly string[]
  season: number
  week: number
}): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>()
  const sports = [...new Set(args.sports.map((s) => String(s || 'NFL').toUpperCase()))]
  if (args.sleeperIds.length === 0 || sports.length === 0) return out
  const playerRows = await prisma.sportsPlayer
    .findMany({
      where: { sleeperId: { in: [...args.sleeperIds] }, sport: { in: sports } },
      select: { sleeperId: true, name: true, team: true, sport: true },
    })
    .catch(() => [])
  await Promise.all(
    sports.map(async (sport) => {
      const players = playerRows.filter((p) => String(p.sport).toUpperCase() === sport)
      const teams = new Map([...composePlayerIdentities(players)].map(([id, p]) => [id, p.team]))
      const [statuses, byes] = await Promise.all([
        readInjuryStatusById(sport, namesBySleeperId(players), teams),
        getByeWeeks({ sport, season: args.season, playerTeams: teams, fromWeek: args.week, horizon: 0 }).catch(() => null),
      ])
      out.set(
        sport,
        new Set([
          ...[...statuses].filter(([, status]) => isRuledOut(status)).map(([id]) => id),
          ...(byes?.byWeek.get(args.week) ?? []),
        ]),
      )
    }),
  )
  return out
}
