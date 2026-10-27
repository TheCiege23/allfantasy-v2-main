/**
 * A daily sport's (NBA) week of stats, re-read from `player_game_stats` for the stat-correction check.
 *
 * DB-first on purpose: the scheduled game-stats import (`/api/cron/import-player-game-stats?multiSport=1`)
 * re-sweeps the last few days on every run, so a correction to a recent game lands in that table. The
 * check compares the week re-summed from those rows with what `PlayerWeeklyScore` was sealed from — the
 * NFL check pulls the provider instead, because NFL corrections never reach a table on their own.
 *
 * Built from the SAME primitives the weekly sync uses (lib/redraft/playerWeeklyScoreService.ts, its daily
 * branch): the season's week window, the roster-id → game-log-id bridge, the preseason filter and the
 * sport's weekly aggregation. So the fresh numbers are summed exactly as the stored ones were; a second
 * summing rule would report differences that are only the two rules disagreeing.
 *
 * Read-only: nothing here writes a score.
 */
import { prisma } from '@/lib/prisma'
import { aggregateWeeklyStats, getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { ensureDailySportSeasonStart } from '@/lib/season-week/deriveDailySportSeasonStart'
import { resolveStoredSeasonType } from '@/lib/sports-data/riSeasonType'
import { bridgeRosterIdsToGameLogIds } from '@/lib/redraft/rosterGameLogIdBridge'

export type DailyWeekStatsFetcher = (args: {
  sport: string
  season: number
  week: number
  players: Array<{ playerId: string; playerName: string | null }>
}) => Promise<Map<string, Record<string, number>>>

const sportKeys = (sport: string) => {
  const upper = sport.toUpperCase()
  const lower = sport.toLowerCase()
  return upper === lower ? [upper] : [upper, lower]
}

export const loadDailyWeekStats: DailyWeekStatsFetcher = async ({ sport, season, week, players }) => {
  const out = new Map<string, Record<string, number>>()
  const normalizer = getDailySportNormalizer(sport)
  if (!normalizer || players.length === 0) return out
  await ensureDailySportSeasonStart(sport, season, { db: prisma as never })
  const window = resolveDailySportWeekWindow(sport, season, week)
  if (!window) return out

  const namesById = new Map(players.map((p) => [p.playerId, p.playerName]))
  const bridge = await bridgeRosterIdsToGameLogIds(prisma as never, sportKeys(sport), players.map((p) => p.playerId), namesById)
  const rows = await prisma.playerGameStat.findMany({
    where: { playerId: { in: bridge.gameLogIds }, sportType: { in: sportKeys(sport) }, gameDate: { gte: window.start, lt: window.end } },
    select: { playerId: true, normalizedStatMap: true, sportType: true, season: true, gameDate: true },
  })
  const byPlayer = new Map<string, unknown[]>()
  for (const row of rows) {
    if (resolveStoredSeasonType({ normalizedStatMap: row.normalizedStatMap, sport: row.sportType, season: row.season, gameDate: row.gameDate }) === 'pre') continue
    const rosterId = bridge.rosterIdFor(row.playerId)
    if (!rosterId) continue
    const list = byPlayer.get(rosterId) ?? []
    list.push(row.normalizedStatMap)
    byPlayer.set(rosterId, list)
  }
  for (const [playerId, list] of byPlayer) {
    const aggregate = aggregateWeeklyStats(list, normalizer)
    if (aggregate.gamesCounted > 0 && Object.keys(aggregate.stats).length > 0) out.set(playerId, aggregate.stats)
  }
  return out
}
