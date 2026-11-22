import 'server-only'

import { prisma } from '@/lib/prisma'
import { buildChampionRafters, type ChampionRafters } from './dynastyHomeExtras'
import { firstSeasonOf } from '@/lib/dynasty-core/dynastyDetails'

/**
 * Past champions for a dynasty league's rafters, from the two tables that record them: `league_seasons`
 * (imported history and native rollover) and `league_championships` (native playoff runtime, Guilly,
 * Survivor). Moved here from the dynasty-hub handler so /core's league Home reads the SAME rows the
 * workspace's rafters do rather than a second copy of the query.
 *
 * Also returns the earliest season either table holds, which is what "Year N" counts from when the
 * commissioner never set `startup_season` (`dynastyYearOf` in lib/dynasty-core/dynastyDetails.ts).
 * Best-effort: a failed read is an empty history, and the rafters hide.
 */
export async function loadChampionHistory(
  leagueId: string,
  userId: string,
  currentSeason: number | null,
): Promise<{ rafters: ChampionRafters | null; firstSeason: number | null }> {
  const [seasons, championships] = await Promise.all([
    prisma.leagueSeason
      .findMany({
        where: { leagueId },
        select: {
          season: true,
          championName: true,
          championTeam: { select: { platformUserId: true, claimedByUserId: true, teamName: true } },
        },
      })
      .catch(() => []),
    prisma.leagueChampionship
      .findMany({ where: { leagueId }, select: { season: true, championUserId: true, teamName: true } })
      .catch(() => []),
  ])
  const rafters = buildChampionRafters({
    seasons: seasons.map((row) => ({
      season: row.season,
      championName: row.championName,
      championTeamUserIds: row.championTeam ? [row.championTeam.platformUserId, row.championTeam.claimedByUserId] : [],
      championTeamName: row.championTeam?.teamName ?? null,
    })),
    championships,
    viewerUserId: userId,
    currentSeason: Number.isInteger(currentSeason) ? currentSeason : null,
  })
  return { rafters, firstSeason: firstSeasonOf([...seasons, ...championships]) }
}

export async function loadChampionRafters(leagueId: string, userId: string, currentSeason: number): Promise<ChampionRafters | null> {
  return (await loadChampionHistory(leagueId, userId, currentSeason)).rafters
}
