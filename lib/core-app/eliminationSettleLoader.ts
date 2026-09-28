import 'server-only'

import { prisma } from '@/lib/prisma'
import { isScored } from './currentWeek'
import { starterGameStates, type StarterGameState } from './matchupGameState'
import { composePlayerIdentities } from './playerIdentityCompose'
import { settleEliminationWeek, type EliminationSettle, type SettleTeam } from './eliminationSettle'
import { scheduleForLeague, survivorHorizon } from '@/lib/trade-intel/survivorSchedule'

/**
 * The inputs `settleEliminationWeek` needs, for ONE league-week, from the database.
 *
 * - The field: this week's `WeeklyMatchup` rows that carry a score — the same field
 *   `buildEliminationWeeks` draws the cut line from.
 * - Each team's starters: `LeaguePlayerWeeklyScore` rows with `isStarter`, keyed by the platform's
 *   roster id. Sleeper writes a row for every starter of a roster that has started scoring,
 *   including a 0 for one yet to play — so a roster with NO rows is "unknown", never "finished".
 * - Game states: the week's `SportsGame` rows through `starterGameStates`, exactly as the matchup
 *   screen reads them (`matchup.ts`).
 * - Chops: the published schedule's `chopsThisWeek` where the league has one, otherwise 1.
 *
 * Returns null on any read failure — the caller then says nothing new rather than something wrong.
 */
export async function loadEliminationSettle(args: {
  platformLeagueId: string
  season: number
  week: number
  yourRosterId: string
  sport?: string
}): Promise<EliminationSettle | null> {
  const { platformLeagueId, season, week } = args
  try {
    const [rows, starterRows] = await Promise.all([
      prisma.weeklyMatchup.findMany({
        where: { leagueId: platformLeagueId, seasonYear: season, week },
        select: { rosterId: true, pointsFor: true, pointsAgainst: true },
      }),
      prisma.leaguePlayerWeeklyScore.findMany({
        where: { leagueId: platformLeagueId, seasonYear: season, week, isStarter: true },
        select: { playerId: true, rosterId: true },
      }),
    ])
    const field = rows.filter(isScored)
    if (field.length < 2) return null

    const ids = [...new Set(starterRows.map((r) => r.playerId))]
    const [identityRows, games] = await Promise.all([
      ids.length
        ? prisma.sportsPlayer.findMany({
            where: { sleeperId: { in: ids } },
            select: { sleeperId: true, name: true, position: true, team: true, sport: true, imageUrl: true },
          })
        : Promise.resolve([]),
      prisma.sportsGame.findMany({
        where: { sport: args.sport ?? 'NFL', season, week, OR: [{ seasonType: 'regular' }, { seasonType: null }] },
        select: { homeTeam: true, awayTeam: true, status: true, startTime: true, fetchedAt: true, seasonType: true },
        take: 400,
      }),
    ])
    const states = starterGameStates(composePlayerIdentities(identityRows), games)

    const startersByRoster = new Map<string, StarterGameState[]>()
    for (const r of starterRows) {
      if (r.rosterId == null) continue
      const key = String(r.rosterId)
      const list = startersByRoster.get(key) ?? []
      list.push(states.get(r.playerId) ?? 'unknown')
      startersByRoster.set(key, list)
    }

    const teams: SettleTeam[] = field.map((r) => ({
      rosterId: String(r.rosterId),
      points: r.pointsFor,
      starters: startersByRoster.get(String(r.rosterId)) ?? [],
    }))

    const schedule = scheduleForLeague(platformLeagueId)
    const chops = (schedule ? survivorHorizon(schedule, week)?.chopsThisWeek : null) ?? 1

    return settleEliminationWeek({ field: teams, yourRosterId: String(args.yourRosterId), chops })
  } catch {
    return null
  }
}
