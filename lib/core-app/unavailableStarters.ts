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
  const absences = await loadAbsencesBySport(args)
  return new Map([...absences].map(([sport, byId]) => [sport, new Set(byId.keys())]))
}

/** Why a player cannot score this week: a designation that rules him out, or his club is off. */
export type Absence = { kind: 'ruled_out'; status: string } | { kind: 'bye' }

/**
 * `loadUnavailableBySport` with the REASON kept — the same reads and the same `isRuledOut` rule, so the
 * two can never disagree about who is out; that one is this one's key set. For a surface that has to
 * say WHY ("IR", "on bye") rather than only price him at zero. A designation wins over a bye when a
 * player has both.
 */
export async function loadAbsencesBySport(args: {
  sleeperIds: readonly string[]
  sports: readonly string[]
  season: number
  week: number
}): Promise<Map<string, Map<string, Absence>>> {
  const out = new Map<string, Map<string, Absence>>()
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
      const byId = new Map<string, Absence>()
      for (const [id, status] of statuses) {
        if (status && isRuledOut(status)) byId.set(id, { kind: 'ruled_out', status })
      }
      for (const id of byes?.byWeek.get(args.week) ?? []) {
        if (!byId.has(id)) byId.set(id, { kind: 'bye' })
      }
      out.set(sport, byId)
    }),
  )
  return out
}
