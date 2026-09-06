import { prisma } from '@/lib/prisma'
import { generateSchedule } from '@/lib/redraft/scheduleEngine'

export type NextRedraftSeasonShell = { id: string; season: number }

/**
 * Ensures a "next" RedraftSeason exists for a league whose season just
 * completed, so keeper-carryover and next-season flows have somewhere real
 * to write to. Creates one (with RedraftRoster shells preserving ownership,
 * plus a generated schedule) only when nothing newer already exists for the
 * league — matching the exact shape `POST /api/redraft/season` produces, so
 * a league that already created its next season by hand is left untouched.
 */
export async function ensureNextRedraftSeasonShell(
  leagueId: string,
  completedSeasonId: string,
): Promise<NextRedraftSeasonShell | null> {
  const existing = await prisma.redraftSeason.findFirst({
    where: { leagueId, NOT: { id: completedSeasonId } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, season: true },
  })
  if (existing) return existing

  const completedSeason = await prisma.redraftSeason.findUnique({
    where: { id: completedSeasonId },
    select: { sport: true, season: true, totalWeeks: true, playoffStartWeek: true, medianGame: true },
  })
  if (!completedSeason) return null

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    include: { teams: true },
  })
  if (!league) return null

  const nextSeasonYear = completedSeason.season + 1

  return prisma.$transaction(async (tx) => {
    const rs = await tx.redraftSeason.create({
      data: {
        leagueId,
        sport: completedSeason.sport,
        season: nextSeasonYear,
        status: 'setup',
        totalWeeks: completedSeason.totalWeeks,
        playoffStartWeek: completedSeason.playoffStartWeek,
        currentWeek: 0,
        medianGame: completedSeason.medianGame,
      },
    })

    const rosters: { id: string }[] = []
    for (const t of league.teams) {
      const ownerId = t.claimedByUserId ?? league.userId
      const r = await tx.redraftRoster.create({
        data: {
          seasonId: rs.id,
          leagueId,
          ownerId,
          ownerName: t.ownerName,
          teamName: t.teamName,
          avatarUrl: t.avatarUrl,
        },
      })
      rosters.push({ id: r.id })
    }

    const slots = generateSchedule(
      rosters,
      completedSeason.totalWeeks,
      completedSeason.playoffStartWeek,
      completedSeason.sport,
      { medianGame: completedSeason.medianGame },
    )
    for (const s of slots) {
      if (s.type === 'median') continue
      await tx.redraftMatchup.create({
        data: {
          seasonId: rs.id,
          leagueId,
          week: s.week,
          type: 'regular',
          homeRosterId: s.home,
          awayRosterId: s.away,
          isMedianMatchup: false,
        },
      })
    }

    await tx.league.update({
      where: { id: leagueId },
      data: { season: nextSeasonYear },
    })

    return { id: rs.id, season: nextSeasonYear }
  })
}
