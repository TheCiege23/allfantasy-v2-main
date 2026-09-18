import 'server-only'

import { prisma } from '@/lib/prisma'
import { getAllCanonicalTeams } from '@/lib/team-abbrev'
import { byeStatus, BYE_WEEKS } from './byeStatus'
import { unresolvedClubNames, weekKickoffs } from './playerGame'
import type { FixtureRow } from './nextGameMap'

/**
 * Which week each NFL club has its bye, for one season — read from the schedule we hold.
 *
 * ── 🛑 THE TABLE THIS REPLACES WAS A HARDCODED 2025 SLATE ─────────────────────────────────────
 * `lib/waiver-engine/team-needs.ts` carried `NFL_BYE_WEEKS_2025` and used it in the 2026 season, so
 * every bye-week cluster it produced was last year's. Waiver advice then boosted the wrong players
 * ("two of your starters are out in week 10") and stayed silent on the weeks that mattered. A table
 * keyed to a year is wrong every year but one, and nothing tells you which year you are in.
 *
 * ⚠ THERE IS NO BYE COLUMN TO READ — `fantasy_players.bye_week` holds zero NFL rows and has no
 * writer (measured 2026-09-06, see `byeStatus.ts`). A bye is a club's ABSENCE from a week's
 * fixtures, and an absence is also what a missing fixture looks like. So this asks `byeStatus`, the
 * one rule in this repo that separates the two, rather than deriving a second opinion: a week only
 * yields byes when its slate has the shape of a real bye week (5–14, an even number of absent
 * clubs, two to six of them, every club spelling resolved).
 *
 * ⚠ A WEEK THAT CANNOT BE JUDGED CONTRIBUTES NOTHING, and a club with no answer is simply absent
 * from the map. The caller must read a missing club as "we do not know his bye", never as "no bye" —
 * `computeByeWeekClusters` does, by producing no cluster for him at all. An empty map costs the
 * advice a bye warning; a wrong map is what the 2025 table was.
 */

/** The subset a bye read needs; any richer `select` satisfies it. */
type ByeFixtureRow = FixtureRow & { week: number | null }

export type ByeWeekMap = Record<string, number>

export async function resolveByeWeekMap(season: number, sport = 'NFL'): Promise<ByeWeekMap> {
  const [first, last] = BYE_WEEKS
  const rows = await prisma.sportsGame
    .findMany({
      where: {
        sport: { equals: sport, mode: 'insensitive' },
        season,
        week: { gte: first, lte: last },
        /*
         * ⚠ PRESEASON WEEK 7 AND REGULAR WEEK 7 ARE DIFFERENT SLATES and share a week number. The
         * column is null on the provider that does not carry it, so null is kept: excluding it would
         * drop real fixtures and manufacture byes out of the gap.
         */
        NOT: { seasonType: 'pre' },
      },
      select: { week: true, homeTeam: true, awayTeam: true, startTime: true, seasonType: true, venue: true },
    })
    .catch(() => [] as ByeFixtureRow[])

  const byWeek = new Map<number, ByeFixtureRow[]>()
  for (const row of rows as ByeFixtureRow[]) {
    if (row.week == null) continue
    const list = byWeek.get(row.week)
    if (list) list.push(row)
    else byWeek.set(row.week, [row])
  }

  const clubs = getAllCanonicalTeams()
  const out: ByeWeekMap = {}
  for (const [week, games] of byWeek) {
    const kickoffs = weekKickoffs(games)
    const unresolved = unresolvedClubNames(games).length
    for (const { abbrev } of clubs) {
      if (out[abbrev] != null) continue
      if (byeStatus(abbrev, kickoffs, week, unresolved) === 'bye') out[abbrev] = week
    }
  }
  return out
}
