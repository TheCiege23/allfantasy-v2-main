import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { generateSchedule } from '@/lib/redraft/scheduleEngine'
import { scheduleDivisionsForRosters } from '@/lib/league/divisions/leagueDivisions'

export type NextRedraftSeasonShell = { id: string; season: number }

/** The client the shell is written through: the global client, or a caller's open transaction. */
type ShellDb = Pick<Prisma.TransactionClient, 'redraftSeason' | 'league' | 'redraftRoster' | 'redraftMatchup'>

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
  /**
   * An open transaction to write the shell in. The renewal flow passes its own so the new season,
   * the roster reset and the new draft commit or roll back together; without one the shell gets a
   * transaction of its own, as before.
   */
  db?: ShellDb,
): Promise<NextRedraftSeasonShell | null> {
  const client: ShellDb = db ?? prisma
  const existing = await client.redraftSeason.findFirst({
    where: { leagueId, NOT: { id: completedSeasonId } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, season: true },
  })
  if (existing) return existing

  const completedSeason = await client.redraftSeason.findUnique({
    where: { id: completedSeasonId },
    select: { sport: true, season: true, totalWeeks: true, playoffStartWeek: true, medianGame: true },
  })
  if (!completedSeason) return null

  const league = await client.league.findFirst({
    where: { id: leagueId },
    include: { teams: true },
  })
  if (!league) return null

  /*
   * 🛑 NEXT SEASON'S TEAMS ARE LAST SEASON'S TEAMS — CLONE THEM, DO NOT REBUILD THEM.
   * This used to rebuild every roster from `LeagueTeam`, sending each unclaimed team to the
   * commissioner. The moment a commissioner who owns a team also had an unclaimed one, that was
   * two rosters for one owner, `@@unique([seasonId, ownerId])` rejected the second, and the whole
   * shell rolled back — no next season, so no keeper window and nowhere for a dynasty roster to
   * go. Cloning keeps each team's identity (`roster:<id>` for an orphan) exactly as the season
   * engine wrote it, which is also what lets carryover match teams across the two seasons.
   */
  const previousRosters = await client.redraftRoster.findMany({
    where: { leagueId, seasonId: completedSeasonId },
    orderBy: { id: 'asc' },
    select: { ownerId: true, ownerName: true, teamName: true, avatarUrl: true },
  })
  const shells: Array<{ ownerId: string; ownerName: string; teamName: string | null; avatarUrl: string | null }> = []
  if (previousRosters.length > 0) {
    shells.push(...previousRosters)
  } else {
    const used = new Set<string>()
    for (const t of league.teams) {
      let ownerId = t.claimedByUserId ?? league.userId
      if (used.has(ownerId)) ownerId = `roster:${t.externalId || t.id}`
      used.add(ownerId)
      shells.push({ ownerId, ownerName: t.ownerName, teamName: t.teamName, avatarUrl: t.avatarUrl })
    }
  }

  const nextSeasonYear = completedSeason.season + 1

  const write = async (tx: ShellDb): Promise<NextRedraftSeasonShell> => {
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
    const rosterTeam: Array<{ rosterId: string; ids: string[] }> = []
    for (const t of shells) {
      const r = await tx.redraftRoster.create({
        data: {
          seasonId: rs.id,
          leagueId,
          ownerId: t.ownerId,
          ownerName: t.ownerName,
          teamName: t.teamName,
          avatarUrl: t.avatarUrl,
        },
      })
      rosters.push({ id: r.id })
      // An orphan team's owner id is `roster:<externalId or team id>`; either form names its team.
      rosterTeam.push({ rosterId: r.id, ids: [t.ownerId, t.ownerId.startsWith('roster:') ? t.ownerId.slice('roster:'.length) : null].filter((v): v is string => Boolean(v)) })
    }

    const divisions = scheduleDivisionsForRosters(league.settings, league.teams, rosterTeam)
    const slots = generateSchedule(
      rosters,
      completedSeason.totalWeeks,
      completedSeason.playoffStartWeek,
      completedSeason.sport,
      {
        medianGame: completedSeason.medianGame,
        divisionByRoster: divisions?.byRoster ?? null,
        divisionRivalsTwice: divisions?.rivalsTwice === true,
      },
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
  }
  return db ? write(db) : prisma.$transaction((tx) => write(tx))
}
