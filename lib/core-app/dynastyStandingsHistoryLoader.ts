import 'server-only'

import { prisma } from '@/lib/prisma'
import { loadChampionHistory } from '@/lib/league/dynastyChampionRafters'
import { buildDynastyStandingsHistory, type DynastyStandingsHistory } from './dynastyStandingsHistory'

/**
 * Reads for the Dynasty table on /core's Standings (`buildDynastyStandingsHistory`). Postgres only —
 * no provider is called; history arrives through the import and season-archive writers.
 *
 * The rafters are `loadChampionHistory`'s, the same read /core's league Home and the dynasty hub use,
 * so the pennants on Standings cannot disagree with the ones on Home.
 *
 * Best-effort like the rest of the screen's optional sections: each read that fails is an empty set,
 * and the builder then says what is missing rather than the screen failing.
 */
export async function loadDynastyStandingsHistory(
  leagueId: string,
  userId: string,
  currentSeason: number | null,
): Promise<DynastyStandingsHistory> {
  const [seasons, championships, teams, standingFacts, champions] = await Promise.all([
    prisma.leagueSeason
      .findMany({
        where: { leagueId },
        select: { season: true, status: true, teamRecords: true, championName: true, championTeamId: true },
      })
      .catch(() => []),
    prisma.leagueChampionship
      .findMany({ where: { leagueId }, select: { season: true, championUserId: true, teamName: true } })
      .catch(() => []),
    prisma.leagueTeam
      .findMany({
        where: { leagueId },
        select: { id: true, externalId: true, platformUserId: true, claimedByUserId: true, teamName: true, ownerName: true },
      })
      .catch(() => []),
    prisma.seasonStandingFact
      .findMany({
        where: { leagueId },
        select: { season: true, teamId: true, wins: true, losses: true, ties: true, pointsFor: true },
      })
      .catch(() => []),
    loadChampionHistory(leagueId, userId, currentSeason).catch(() => ({ rafters: null, firstSeason: null })),
  ])
  return buildDynastyStandingsHistory({
    seasons,
    championships,
    teams,
    standingFacts,
    viewerUserId: userId,
    rafters: champions.rafters,
  })
}
