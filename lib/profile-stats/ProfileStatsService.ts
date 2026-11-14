/**
 * Profile stats service (PROMPT 308).
 * Aggregates record, rankings, and achievements for the user profile.
 */

import { prisma } from "@/lib/prisma"
import { buildWeeklyRecapPayload } from "@/lib/weekly-recap-engine/WeeklyRecapEngine"
import { getAchievementsForUser } from "@/lib/achievement-system"
import type { ProfileStats, RecordSummary, RankingEntry } from "./types"

async function getSleeperUserId(appUserId: string): Promise<string | null> {
  const user = await prisma.appUser.findUnique({
    where: { id: appUserId },
    select: { legacyUserId: true },
  })
  if (!user?.legacyUserId) return null
  const legacy = await prisma.legacyUser.findUnique({
    where: { id: user.legacyUserId },
    select: { sleeperUserId: true },
  })
  return legacy?.sleeperUserId ?? null
}

/**
 * Batch-resolve "my" roster/team ids per league for draft grades (avoids N+1).
 * Returns Map<leagueId, string[]> of roster or team ids that represent the user in each league.
 */
async function batchGetMyRosterOrTeamIdsByLeague(
  leagueIds: string[],
  sleeperUserId: string | null
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  if (!sleeperUserId || leagueIds.length === 0) return result

  const leagues = await prisma.league.findMany({
    where: { id: { in: leagueIds } },
    select: { id: true, legacyLeagueId: true },
  })

  const rosters = await prisma.roster.findMany({
    where: { leagueId: { in: leagueIds }, platformUserId: sleeperUserId },
    select: { id: true, leagueId: true },
  })
  for (const r of rosters) {
    const arr = result.get(r.leagueId) ?? []
    arr.push(r.id)
    result.set(r.leagueId, arr)
  }

  const legacyLeagueIds = leagues.map((l) => l.legacyLeagueId).filter((id): id is string => id != null)
  if (legacyLeagueIds.length > 0) {
    const legacyRosters = await prisma.legacyRoster.findMany({
      where: { leagueId: { in: legacyLeagueIds }, ownerId: sleeperUserId },
      select: { id: true, leagueId: true },
    })
    const legacyToAppLeague = new Map<string, string>()
    for (const l of leagues) {
      if (l.legacyLeagueId) legacyToAppLeague.set(l.legacyLeagueId, l.id)
    }
    const teamIds = legacyRosters.length > 0
      ? await prisma.leagueTeam.findMany({
          where: {
            legacyRosterId: { in: legacyRosters.map((lr) => lr.id) },
            leagueId: { in: leagueIds },
          },
          select: { id: true, leagueId: true },
        })
      : []
    for (const t of teamIds) {
      const arr = result.get(t.leagueId) ?? []
      arr.push(t.id)
      result.set(t.leagueId, arr)
    }
  }

  return result
}

/**
 * Fetch profile stats: record, draft rankings, achievements.
 */
export async function getProfileStats(userId: string): Promise<ProfileStats> {
  const [recap, achievements, leagues] = await Promise.all([
    buildWeeklyRecapPayload(userId),
    getAchievementsForUser(userId),
    prisma.league.findMany({
      where: { userId },
      select: { id: true, name: true, season: true, sport: true },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
  ])

  const record: RecordSummary = {
    wins: recap.totalWins,
    losses: recap.totalLosses,
    ties: recap.totalTies,
    byLeague: recap.leagues
      .filter((l) => l.myRecord)
      .map((l) => ({
        leagueId: l.leagueId,
        leagueName: l.leagueName,
        sport: l.sport,
        wins: l.myRecord!.wins,
        losses: l.myRecord!.losses,
        ties: l.myRecord!.ties,
        rank: l.rank,
        pointsFor: l.pointsFor,
      })),
  }

  const sleeperUserId = await getSleeperUserId(userId)
  const myIdsByLeagueResolved = await batchGetMyRosterOrTeamIdsByLeague(
    leagues.map((l) => l.id),
    sleeperUserId
  )

  const rankings: RankingEntry[] = []
  const leagueIdsWithMe = leagues.filter((l) => (myIdsByLeagueResolved.get(l.id)?.length ?? 0) > 0)
  if (leagueIdsWithMe.length > 0) {
    const allGrades = await prisma.draftGrade.findMany({
      where: {
        leagueId: { in: leagueIdsWithMe.map((l) => l.id) },
        season: { in: [...new Set(leagueIdsWithMe.map((l) => String(l.season ?? new Date().getFullYear())))] },
      },
      select: { leagueId: true, season: true, grade: true, score: true, breakdown: true, rosterId: true },
    })
    const leagueById = new Map(leagues.map((l) => [l.id, l]))
    for (const g of allGrades) {
      const myIds = myIdsByLeagueResolved.get(g.leagueId) ?? []
      if (!myIds.includes(g.rosterId)) continue
      const league = leagueById.get(g.leagueId)
      const breakdown = (g.breakdown as { rank?: number }) ?? {}
      rankings.push({
        leagueId: g.leagueId,
        leagueName: league?.name ?? "League",
        season: g.season,
        sport: league?.sport ?? undefined,
        grade: g.grade,
        rank: breakdown.rank ?? 0,
        score: Number(g.score),
      })
    }
  }

  rankings.sort((a, b) => a.rank - b.rank)

  return {
    record,
    rankings,
    achievements,
  }
}
