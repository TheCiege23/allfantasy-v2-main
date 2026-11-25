import { prisma } from '@/lib/prisma'

/**
 * Sports whose redraft pool counts "has played this season" as roster evidence
 * (`reconcileCurrentProRows`). The two measured on 2026-11-25, both in season. MLB shares the roster
 * filter but was out of season and not measured, so it is not listed.
 */
const PLAYED_THIS_SEASON_SPORTS = ['NBA', 'NHL']

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
  if (!PLAYED_THIS_SEASON_SPORTS.includes(sport)) return new Set()
  const where = { sport, source: 'rolling_insights', seasonType: 'regular', gamesPlayed: { gt: 0 } }
  const newest = await prisma.playerSeasonStats.findFirst({ where, orderBy: { season: 'desc' }, select: { season: true } })
  if (!newest?.season) return new Set()
  const rows = await prisma.playerSeasonStats.findMany({ where: { ...where, season: newest.season }, select: { playerId: true } })
  return new Set(rows.map((row) => row.playerId))
}
