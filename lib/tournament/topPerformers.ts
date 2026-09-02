/**
 * The week's best performances across every league in a tournament.
 *
 * 🛑 THIS IS THE READ HALF OF A PAIR, AND IT MUST NOT SHIP WITHOUT THE WRITER.
 * `WeeklyScore` sat empty for imported leagues because its only writer had no
 * scheduled caller — so a screen built on it would have rendered a confident,
 * permanently blank block. The writer is
 * `lib/tournament/ingestWeeklyPlayerScores.ts`; this reads what it commits and
 * never calls a provider.
 *
 * ⚠ IT REPORTS WHICH WEEK IT IS ACTUALLY SHOWING, and returns null rather than
 * an empty list when no week has been ingested. "No data yet" and "nobody scored
 * this week" look identical in a list of zero rows, and only one of them means
 * somebody should go and run the ingest.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'

export type Performance = {
  playerId: string
  /** Resolved name, or null when the player is not in the canonical table. */
  playerName: string | null
  position: string | null
  team: string | null
  points: number
  /** The manager who rostered them, as the commissioner's sheet names them. */
  managerName: string
  leagueName: string
}

export type TopPerformers = {
  tournamentId: string
  /** The week these rows are from — not necessarily the current week. */
  week: number
  season: number
  /** Started, so these points counted. */
  topStarters: Performance[]
  /** Highest scores left on a bench — the week's regrets. */
  topBench: Performance[]
  /** Leagues in the tournament with nothing ingested for this week. */
  leaguesMissingData: string[]
}

const DEFAULT_LIMIT = 10

export async function getTournamentTopPerformers(args: {
  tournamentId: string
  commissionerUserId: string
  season: number
  /** Omit to use the most recent week that has any data. */
  week?: number
  limit?: number
}): Promise<TopPerformers | null> {
  const shell = await prisma.tournamentShell.findFirst({
    where: { id: args.tournamentId, commissionerId: args.commissionerUserId },
    select: { id: true, currentRoundNumber: true },
  })
  /* Same answer for "not found" and "not yours". */
  if (!shell) return null

  /*
   * 🛑 SCOPED TO THE CURRENT ROUND, AND IT WAS NOT UNTIL THE REDRAFT EXISTED.
   * Reading every `TournamentLeague` in the tournament was harmless while there
   * was only ever one round of them. The moment a redraft commits round-2 slots,
   * an unscoped read returns the old leagues AND the new ones — the same manager
   * twice, ranked against himself, in a table that decides who goes home.
   */
  const tournamentLeagues = await prisma.tournamentLeague.findMany({
    where: {
      tournamentId: args.tournamentId,
      leagueId: { not: null },
      round: { roundNumber: shell.currentRoundNumber || 1 },
    },
    select: { leagueId: true, name: true },
  })
  const leagueIds = tournamentLeagues.map((t) => t.leagueId!).filter(Boolean)
  const leagueNameById = new Map(tournamentLeagues.map((t) => [t.leagueId!, t.name]))
  if (leagueIds.length === 0) return null

  /*
   * ⚠ THE LATEST WEEK WITH DATA, NOT THE CURRENT WEEK. Defaulting to "now" shows
   * an empty block every Tuesday before the ingest runs, which reads as a broken
   * feature rather than a week that has not been collected yet.
   */
  let week = args.week
  if (week == null) {
    const latest = await prisma.weeklyScore.findFirst({
      where: { leagueId: { in: leagueIds }, season: args.season },
      orderBy: { week: 'desc' },
      select: { week: true },
    })
    if (!latest) return null
    week = latest.week
  }

  const scores = await prisma.weeklyScore.findMany({
    where: { leagueId: { in: leagueIds }, season: args.season, week },
    select: {
      leagueId: true,
      rosterId: true,
      playerId: true,
      points: true,
      isStarter: true,
    },
    /*
     * ⚠ BOUNDED. Twenty leagues × twelve rosters × ~20 players is ~4,800 rows
     * for one week; taking a generous slice of the top by points keeps this a
     * single indexed read rather than a full-week scan into memory.
     */
    orderBy: { points: 'desc' },
    take: 500,
  })

  if (scores.length === 0) return null

  const rosterIds = [...new Set(scores.map((s) => s.rosterId))]
  const playerIds = [...new Set(scores.map((s) => s.playerId))]

  const [rosters, teams, players] = await Promise.all([
    prisma.roster.findMany({
      where: { id: { in: rosterIds } },
      select: { id: true, leagueId: true, platformUserId: true },
    }),
    prisma.leagueTeam.findMany({
      where: { leagueId: { in: leagueIds } },
      select: {
        leagueId: true,
        platformUserId: true,
        claimedByUserId: true,
        ownerName: true,
        teamName: true,
      },
    }),
    prisma.player.findMany({
      where: { id: { in: playerIds } },
      select: { id: true, name: true, position: true, team: true },
    }),
  ])

  const managerByRoster = new Map<string, string>()
  const handleByLeagueUser = new Map<string, string>()
  /*
   * ⚠ INDEXED UNDER BOTH KEYS. `Roster.platformUserId` holds the platform id for
   * imported managers and the AllFantasy `AppUser.id` for the team the viewer
   * has claimed — so a single-key index names every manager except the
   * commissioner, who would show up as "Unknown manager" on their own board.
   */
  for (const t of teams) {
    const label = t.ownerName?.trim() || t.teamName?.trim() || t.platformUserId || 'Unknown manager'
    if (t.platformUserId) handleByLeagueUser.set(`${t.leagueId}:${t.platformUserId}`, label)
    if (t.claimedByUserId) handleByLeagueUser.set(`${t.leagueId}:${t.claimedByUserId}`, label)
  }
  for (const r of rosters) {
    managerByRoster.set(
      r.id,
      handleByLeagueUser.get(`${r.leagueId}:${r.platformUserId}`) ?? r.platformUserId,
    )
  }

  const playerById = new Map(players.map((p) => [p.id, p]))

  const toPerformance = (s: (typeof scores)[number]): Performance => {
    const p = playerById.get(s.playerId)
    return {
      playerId: s.playerId,
      /* ⚠ Null rather than the id dressed up as a name. An unresolved player is
         a gap in the canonical table, and printing a raw id as if it were a name
         hides that. */
      playerName: p?.name ?? null,
      position: p?.position ?? null,
      team: p?.team ?? null,
      points: s.points,
      managerName: managerByRoster.get(s.rosterId) ?? 'Unknown manager',
      leagueName: leagueNameById.get(s.leagueId) ?? 'League',
    }
  }

  const limit = Math.max(1, args.limit ?? DEFAULT_LIMIT)
  const topStarters = scores.filter((s) => s.isStarter).slice(0, limit).map(toPerformance)
  const topBench = scores.filter((s) => !s.isStarter).slice(0, limit).map(toPerformance)

  const leaguesWithData = new Set(scores.map((s) => s.leagueId))
  const leaguesMissingData = leagueIds
    .filter((id) => !leaguesWithData.has(id))
    .map((id) => leagueNameById.get(id) ?? id)

  return {
    tournamentId: args.tournamentId,
    week,
    season: args.season,
    topStarters,
    topBench,
    leaguesMissingData,
  }
}
