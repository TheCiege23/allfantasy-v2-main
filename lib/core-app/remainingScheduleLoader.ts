import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueContextFor, type LeagueContext } from '@/lib/core-app/leagueContext'
import { yourGamesLeft, type GameLeft } from '@/lib/core-app/remainingSchedule'

/**
 * The read behind the Schedule tab's "Your games left" (2026-11-13): this season's stored pairings after the
 * current week, the league's teams and records, and your claimed team — three reads, bounded by one league.
 * Null when there is nothing to read from (no platform league, no stored season, no current week); a
 * failed read is null too, and the screen simply leaves the section out.
 */
export async function loadYourGamesLeft(
  leagueId: string,
  userId: string,
  ctx: LeagueContext | null | undefined,
  afterWeek: number | null,
): Promise<GameLeft[] | null> {
  if (afterWeek == null) return null
  const lc = leagueContextFor(leagueId, userId, ctx)
  const league = await lc.league()
  const pid = league?.platformLeagueId
  if (!league || !pid) return null
  const latest = await prisma.weeklyMatchup.findFirst({
    where: { leagueId: pid },
    orderBy: { seasonYear: 'desc' },
    select: { seasonYear: true },
  })
  if (!latest) return null
  const [rows, teams, mine] = await Promise.all([
    prisma.weeklyMatchup.findMany({
      where: { leagueId: pid, seasonYear: latest.seasonYear, week: { gt: afterWeek } },
      select: { week: true, rosterId: true, matchupId: true, pointsFor: true, pointsAgainst: true },
    }),
    prisma.leagueTeam.findMany({
      where: { leagueId: league.id },
      select: { externalId: true, teamName: true, ownerName: true, wins: true, losses: true, ties: true },
    }),
    lc.claimedTeams(),
  ])
  return yourGamesLeft({
    rows: rows.map((r) => ({ ...r, rosterId: String(r.rosterId), pointsFor: Number(r.pointsFor ?? 0), pointsAgainst: Number(r.pointsAgainst ?? 0) })),
    myRosterIds: mine.map((t) => t.externalId).filter((x): x is string => Boolean(x)),
    afterWeek,
    teams: teams
      .filter((t) => t.externalId)
      .map((t) => ({
        rosterId: String(t.externalId),
        name: t.teamName?.trim() || t.ownerName?.trim() || null,
        wins: t.wins ?? 0,
        losses: t.losses ?? 0,
        ties: t.ties ?? 0,
      })),
  })
}
