/**
 * A daily sport's (NBA, MLB, NHL) week of stats, re-read from `player_game_stats` for the stat-correction check.
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
 * Daily-lineup leagues are compared day by day (`loadDailyDayStats`), because each day is scored on
 * that day's starters only.
 *
 * Read-only: nothing here writes a score.
 */
import { prisma } from '@/lib/prisma'
import { aggregateWeeklyStats, getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { ensureDailySportSeasonStart } from '@/lib/season-week/deriveDailySportSeasonStart'
import { resolveStoredSeasonType } from '@/lib/sports-data/riSeasonType'
import { bridgeRosterIdsToGameLogIds } from '@/lib/redraft/rosterGameLogIdBridge'
import { dayKey } from '@/lib/redraft/dailyLineups'

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

/** Daily-lineup leagues: each player's stats per Eastern game day — `dayKey` → that day's line. */
export type DailyDayStatsFetcher = (args: {
  sport: string
  season: number
  week: number
  players: Array<{ playerId: string; playerName: string | null }>
}) => Promise<Map<string, Map<string, Record<string, number>>>>

/** The week's regular-season game rows, credited to the ROSTER player they belong to. */
async function loadWeekGameRows(args: {
  sport: string
  season: number
  week: number
  players: Array<{ playerId: string; playerName: string | null }>
}): Promise<Map<string, Array<{ gameDate: Date | null; stats: unknown }>> | null> {
  const { sport, season, week, players } = args
  if (!getDailySportNormalizer(sport) || players.length === 0) return null
  await ensureDailySportSeasonStart(sport, season, { db: prisma as never })
  const window = resolveDailySportWeekWindow(sport, season, week)
  if (!window) return null

  const namesById = new Map(players.map((p) => [p.playerId, p.playerName]))
  const bridge = await bridgeRosterIdsToGameLogIds(prisma as never, sportKeys(sport), players.map((p) => p.playerId), namesById)
  const rows = await prisma.playerGameStat.findMany({
    where: { playerId: { in: bridge.gameLogIds }, sportType: { in: sportKeys(sport) }, gameDate: { gte: window.start, lt: window.end } },
    select: { playerId: true, normalizedStatMap: true, sportType: true, season: true, gameDate: true },
  })
  const byPlayer = new Map<string, Array<{ gameDate: Date | null; stats: unknown }>>()
  for (const row of rows) {
    if (resolveStoredSeasonType({ normalizedStatMap: row.normalizedStatMap, sport: row.sportType, season: row.season, gameDate: row.gameDate }) === 'pre') continue
    const rosterId = bridge.rosterIdFor(row.playerId)
    if (!rosterId) continue
    const list = byPlayer.get(rosterId) ?? []
    list.push({ gameDate: row.gameDate, stats: row.normalizedStatMap })
    byPlayer.set(rosterId, list)
  }
  return byPlayer
}

export const loadDailyWeekStats: DailyWeekStatsFetcher = async (args) => {
  const out = new Map<string, Record<string, number>>()
  const normalizer = getDailySportNormalizer(args.sport)
  const byPlayer = await loadWeekGameRows(args)
  if (!normalizer || !byPlayer) return out
  for (const [playerId, list] of byPlayer) {
    const aggregate = aggregateWeeklyStats(list.map((r) => r.stats), normalizer)
    if (aggregate.gamesCounted > 0 && Object.keys(aggregate.stats).length > 0) out.set(playerId, aggregate.stats)
  }
  return out
}

/**
 * The same rows, one line per Eastern game day — bucketed by `dayKey(gameDate)` and summed by the
 * normalizer exactly as the sync's `writePlayerDailyScores` builds `player_daily_scores`, so a day
 * compares like for like with the line it was scored on.
 */
export const loadDailyDayStats: DailyDayStatsFetcher = async (args) => {
  const out = new Map<string, Map<string, Record<string, number>>>()
  const normalizer = getDailySportNormalizer(args.sport)
  const byPlayer = await loadWeekGameRows(args)
  if (!normalizer || !byPlayer) return out
  for (const [playerId, list] of byPlayer) {
    const rowsByDay = new Map<string, unknown[]>()
    for (const r of list) {
      if (!r.gameDate) continue
      const key = dayKey(r.gameDate)
      rowsByDay.set(key, [...(rowsByDay.get(key) ?? []), r.stats])
    }
    const days = new Map<string, Record<string, number>>()
    for (const [key, rows] of rowsByDay) {
      const aggregate = aggregateWeeklyStats(rows, normalizer)
      if (aggregate.gamesCounted > 0 && Object.keys(aggregate.stats).length > 0) days.set(key, aggregate.stats)
    }
    if (days.size > 0) out.set(playerId, days)
  }
  return out
}
