import { prisma } from '@/lib/prisma'

/**
 * Sports whose redraft pool counts "has played this season" as roster evidence
 * (`reconcileCurrentProRows`), and how many regular-season games it takes.
 *
 * NBA and NHL: one. Measured 2026-11-25, both in season.
 *
 * MLB: ten. Measured the same day, out of season: 832 players with a 2026 game were outside the pool.
 * 153 of them had ten or more (Luis Arraez 151, Daulton Varsho 140, Marcell Ozuna 70), and 493 had
 * one to three, which is a September call-up or less. Ten keeps the first group and not the second.
 */
const PLAYED_THIS_SEASON_MIN_GAMES: Record<string, number> = { NBA: 1, NHL: 1, MLB: 10 }

/**
 * Rolling Insights player ids with at least one regular-season game in the newest season on file
 * for the sport. Ids join directly (`player_season_stats.playerId` is the Rolling Insights id that
 * `SportsPlayer.externalId` carries); names never join statistics.
 *
 * The newest season on file, not a year worked out from today's date: an NBA or NHL season spans
 * two calendar years and is stored under the year it starts in. Before a new season's first game the
 * newest season is the one just finished, which is the best evidence there is until then.
 */
export async function loadPlayedThisSeasonIds(sport: string): Promise<Set<string>> {
  const minGames = PLAYED_THIS_SEASON_MIN_GAMES[sport]
  if (!minGames) return new Set()
  const where = { sport, source: 'rolling_insights', seasonType: 'regular', gamesPlayed: { gt: 0 } }
  const newest = await prisma.playerSeasonStats.findFirst({ where, orderBy: { season: 'desc' }, select: { season: true } })
  if (!newest?.season) return new Set()
  const rows = await prisma.playerSeasonStats.findMany({
    where: { ...where, season: newest.season, gamesPlayed: { gte: minGames } }, select: { playerId: true },
  })
  return new Set(rows.map((row) => row.playerId))
}
