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
 * Read-only: nothing here writes a score. (`ensureDailySportSeasonStart` may prime an in-process anchor
 * from the stored schedule; it writes no row.)
 */
import { prisma } from '@/lib/prisma'
import { aggregateWeeklyStats, getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { ensureDailySportSeasonStart } from '@/lib/season-week/deriveDailySportSeasonStart'
import { resolveStoredSeasonType } from '@/lib/sports-data/riSeasonType'
import { bridgeRosterIdsToGameLogIds } from '@/lib/redraft/rosterGameLogIdBridge'
import { dayKey, type PlayerDailyStats } from '@/lib/redraft/dailyLineups'
import { addDatedGameRow, buildPlayerDailyStatLines, type DatedGameRows } from '@/lib/redraft/playerDailyStatLines'

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

/**
 * The week's regular-season `player_game_stats` rows, credited to the ROSTER id they belong to (the
 * bridge), exactly as the sync's daily branch selects them. Shared by both fetchers below so the weekly
 * and the per-day re-sums can never select different rows.
 */
async function loadWeekGameRowsByRosterId(args: {
  sport: string
  season: number
  week: number
  players: Array<{ playerId: string; playerName: string | null }>
}): Promise<Map<string, Array<{ gameDate: Date | null; normalizedStatMap: unknown }>> | null> {
  const { sport, season, week, players } = args
  if (players.length === 0) return null
  await ensureDailySportSeasonStart(sport, season, { db: prisma as never })
  const window = resolveDailySportWeekWindow(sport, season, week)
  if (!window) return null

  const namesById = new Map(players.map((p) => [p.playerId, p.playerName]))
  const bridge = await bridgeRosterIdsToGameLogIds(prisma as never, sportKeys(sport), players.map((p) => p.playerId), namesById)
  const rows = await prisma.playerGameStat.findMany({
    where: { playerId: { in: bridge.gameLogIds }, sportType: { in: sportKeys(sport) }, gameDate: { gte: window.start, lt: window.end } },
    select: { playerId: true, normalizedStatMap: true, sportType: true, season: true, gameDate: true },
  })
  const byPlayer = new Map<string, Array<{ gameDate: Date | null; normalizedStatMap: unknown }>>()
  for (const row of rows) {
    if (resolveStoredSeasonType({ normalizedStatMap: row.normalizedStatMap, sport: row.sportType, season: row.season, gameDate: row.gameDate }) === 'pre') continue
    const rosterId = bridge.rosterIdFor(row.playerId)
    if (!rosterId) continue
    const list = byPlayer.get(rosterId) ?? []
    list.push({ gameDate: row.gameDate, normalizedStatMap: row.normalizedStatMap })
    byPlayer.set(rosterId, list)
  }
  return byPlayer
}

export const loadDailyWeekStats: DailyWeekStatsFetcher = async ({ sport, season, week, players }) => {
  const out = new Map<string, Record<string, number>>()
  const normalizer = getDailySportNormalizer(sport)
  if (!normalizer) return out
  const byPlayer = await loadWeekGameRowsByRosterId({ sport, season, week, players })
  if (!byPlayer) return out
  for (const [playerId, list] of byPlayer) {
    const aggregate = aggregateWeeklyStats(list.map((r) => r.normalizedStatMap), normalizer)
    if (aggregate.gamesCounted > 0 && Object.keys(aggregate.stats).length > 0) out.set(playerId, aggregate.stats)
  }
  return out
}

/** roster playerId → dayKey → that day's line, built IN MEMORY (`PlayerDailyStats`, as the daily scorer reads it). */
export type DailyWeekDayStatsFetcher = (args: {
  sport: string
  season: number
  week: number
  players: Array<{ playerId: string; playerName: string | null }>
}) => Promise<PlayerDailyStats>

/**
 * A daily-lineup week's per-day stat lines, re-built from `player_game_stats` by the SAME grouping and
 * aggregation the sync writes to `player_daily_scores` (`playerDailyStatLines.ts`) — but returned, never
 * written. `isFinalized` is false, as every line the sync writes is.
 */
export const loadDailyWeekDayStats: DailyWeekDayStatsFetcher = async ({ sport, season, week, players }) => {
  const out: PlayerDailyStats = new Map()
  const normalizer = getDailySportNormalizer(sport)
  if (!normalizer) return out
  const byPlayer = await loadWeekGameRowsByRosterId({ sport, season, week, players })
  if (!byPlayer) return out
  for (const [playerId, list] of byPlayer) {
    const byDay: DatedGameRows = new Map()
    for (const r of list) if (r.gameDate) addDatedGameRow(byDay, r.gameDate, r.normalizedStatMap)
    const lines = buildPlayerDailyStatLines(byDay, normalizer)
    if (lines.length === 0) continue
    out.set(playerId, new Map(lines.map((l) => [dayKey(l.day), { stats: l.stats, isFinalized: false }])))
  }
  return out
}
