/**
 * Standings reads for a league that plays on AllFantasy: the records its own season holds.
 * See `lib/standings/nativeSeasonStandings.ts` for why the standings route cannot read
 * `fantasyStanding` / `teamWeekResult` for these leagues. Read-only and DB-only.
 */

import { prisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { buildRosterLabelMap } from '@/lib/scoring-engine/resolveTeamLabels'
import { buildNativeStandings, type NativeStandingRow } from '@/lib/standings/nativeSeasonStandings'

/**
 * The season's standings, keyed by the league page's own roster ids, or null when this league has no
 * season for that year (the caller then answers as it did before).
 */
export async function loadNativeSeasonStandings(args: {
  leagueId: string
  platform: string | null
  seasonYear: number
  scoringMode: 'points' | 'h2h_category' | 'roto'
}): Promise<{ standings: NativeStandingRow[]; scoredWeeks: number } | null> {
  if (!isNativePlatform(args.platform)) return null
  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId: args.leagueId, season: args.seasonYear },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (!season) return null

  const [rosters, games, generic, labels, categoryRows] = await Promise.all([
    prisma.redraftRoster.findMany({
      where: { seasonId: season.id },
      select: { id: true, ownerId: true, ownerName: true, teamName: true, wins: true, losses: true, ties: true, pointsFor: true, pointsAgainst: true, streak: true, playoffSeed: true },
    }),
    prisma.redraftMatchup.findMany({
      where: { seasonId: season.id, status: 'final', isMedianMatchup: false, awayRosterId: { not: null } },
      select: { week: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true },
    }),
    prisma.roster.findMany({ where: { leagueId: args.leagueId }, select: { id: true, platformUserId: true, redraftRosterId: true } }),
    buildRosterLabelMap(args.leagueId),
    // A category league's categories won are stored beside its record by the season engine.
    args.scoringMode === 'h2h_category'
      ? prisma.fantasyStanding.findMany({
          where: { leagueId: args.leagueId, season: args.seasonYear },
          select: { rosterId: true, categoryWinsFor: true, categoryLossesFor: true, categoryTiesFor: true },
        })
      : Promise.resolve([]),
  ])
  if (rosters.length === 0) return null

  // The same link the playoff seeds use (lib/playoff-runtime/playoffSeedPreview.ts): the stored link
  // first, then the owner, then the season roster's own id.
  const ownerOf = new Map(rosters.map((r) => [r.id, r.ownerId]))
  const idFor = (seasonRosterId: string) =>
    generic.find((g) => g.redraftRosterId === seasonRosterId)?.id ??
    generic.find((g) => g.platformUserId != null && g.platformUserId === ownerOf.get(seasonRosterId))?.id ??
    seasonRosterId

  return buildNativeStandings({
    rosters,
    finalGames: games.flatMap((g) =>
      g.awayRosterId ? [{ week: g.week, homeRosterId: g.homeRosterId, awayRosterId: g.awayRosterId, homeScore: g.homeScore, awayScore: g.awayScore }] : [],
    ),
    idFor,
    nameFor: (id) => labels.get(id),
    categoryRecord: new Map(
      categoryRows.map((r) => [r.rosterId, { wins: r.categoryWinsFor ?? 0, losses: r.categoryLossesFor ?? 0, ties: r.categoryTiesFor ?? 0 }]),
    ),
    allPlay: args.scoringMode === 'points',
  })
}
