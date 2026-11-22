/**
 * Loads one week of a daily sport's lineups and schedule for `findIdleStarts`
 * (lib/integrity/dailySportTankingSignals.ts), for every team the tanking scan reads.
 *
 * Returns null — the scan then makes no idle-start claim at all — for a sport outside NBA / NHL /
 * MLB, a week with no date window, or a schedule that cannot be read. Each source is the one the
 * week's scoring and lock already use, so the scan cannot disagree with them about who started on
 * which day or which teams played:
 *   - the day's slot: `dailySlotFor` (daily lineups), else the week's saved lineup (`loadWeekLineups`);
 *     a player neither names has no known slot and is skipped;
 *   - who was on the team: `daysOnRoster` over the rows still rostered or dropped during the week;
 *   - which teams played: `buildWeekKickoffMap(...).byTeamDay`, the daily lock's own schedule read;
 *   - which bench players played: their `player_daily_scores` line for the day (`loadPlayerDailyStats`,
 *     the daily scorer's own read). The sync writes a line only for a day the player had a game, so a
 *     bench player listed Out, or one who never got in, has none and is no alternative.
 */
import type { PrismaClient } from '@prisma/client'
import { DAILY_LINEUP_LOCK_SPORTS, buildWeekKickoffMap, lockTeamLookupKeys } from '@/lib/redraft/lineupLock'
import { dailySlotFor, dayKey, daysInWindow, daysOnRoster, droppedInWindow, isDailyLineupScoringEnabled, loadDailyLineups, loadPlayerDailyStats, type PlayerDailyStats } from '@/lib/redraft/dailyLineups'
import { loadWeekLineups, weekSlotType } from '@/lib/redraft/weekLineupSlots'
import { allowedPositionsForSlot, normalizeToken } from '@/lib/redraft/lineupValidation'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { isNflRedraftScoringStarterSlot } from '@/lib/scoring-runtime/canonicalNflRedraftScoringRuntime'
import { findIdleStarts, type IdleStart } from './dailySportTankingSignals'

export type DailySportIdleStarts = { mode: 'daily' | 'weekly'; byRoster: Map<string, IdleStart[]> }

export async function loadDailySportIdleStarts(
  db: PrismaClient,
  args: { sport: string; leagueSettings: unknown; season: number; week: number; redraftRosterIds: readonly string[] },
): Promise<DailySportIdleStarts | null> {
  const sport = String(args.sport ?? '').trim().toUpperCase()
  if (!DAILY_LINEUP_LOCK_SPORTS.includes(sport) || args.redraftRosterIds.length === 0) return null
  const window = resolveDailySportWeekWindow(sport, args.season, args.week)
  if (!window) return null
  const kickoffs = await buildWeekKickoffMap(db, { sport, season: args.season, week: args.week }).catch(() => null)
  const byTeamDay = kickoffs?.byTeamDay
  if (!byTeamDay || byTeamDay.size === 0) return null

  const mode = isDailyLineupScoringEnabled(args.leagueSettings, sport) ? 'daily' : 'weekly'
  const days = daysInWindow(window)
  const dayKeys = days.map(dayKey)
  const [rows, weekLineups, dailyLineups] = await Promise.all([
    db.redraftRosterPlayer.findMany({
      where: { rosterId: { in: [...args.redraftRosterIds] }, ...droppedInWindow(window) },
      select: { rosterId: true, playerId: true, sport: true, slotType: true, position: true, team: true, addedAt: true, droppedAt: true },
    }),
    loadWeekLineups(db, { redraftRosterIds: args.redraftRosterIds, season: args.season, week: args.week }),
    mode === 'daily' ? loadDailyLineups(db, { redraftRosterIds: args.redraftRosterIds, window }) : Promise.resolve(null),
  ])

  // Per sport, as the daily scorer reads it. Weekly lineups need no bench alternative, so none is read.
  const dailyStats = new Map<string, PlayerDailyStats>()
  if (mode === 'daily') {
    for (const playerSport of new Set(rows.map((r) => r.sport))) {
      const playerIds = [...new Set(rows.filter((r) => r.sport === playerSport).map((r) => r.playerId))]
      dailyStats.set(playerSport, await loadPlayerDailyStats(db, { playerIds, sport: playerSport, season: args.season, window }))
    }
  }
  const sportOf = new Map(rows.map((r) => [r.playerId, r.sport]))
  const played = (playerId: string, day: string): boolean | null => {
    const stats = dailyStats.get(sportOf.get(playerId) ?? '')
    return stats ? stats.get(playerId)?.has(day) === true : null
  }

  const teamPlays = (team: string | null, day: string | null): boolean | null => {
    for (const key of lockTeamLookupKeys(sport, team)) {
      const games = byTeamDay.get(key)
      if (!games) continue
      return day == null ? games.size > 0 : games.has(day)
    }
    return null
  }
  const slotAccepts = (slot: string, position: string) => allowedPositionsForSlot(sport, slot).includes(normalizeToken(position))

  const byRoster = new Map<string, IdleStart[]>()
  for (const rosterId of args.redraftRosterIds) {
    const players = rows
      .filter((r) => r.rosterId === rosterId)
      .map((r) => {
        const savedThisWeek = weekLineups.get(rosterId)?.has(r.playerId) === true
        const weekly = savedThisWeek ? weekSlotType(r, weekLineups) : null
        return {
          playerId: r.playerId,
          position: r.position,
          team: r.team,
          daysOnTeam: daysOnRoster(r, days).map(dayKey),
          slotOn: (day: string) => {
            const daily = dailyLineups ? dailySlotFor(dailyLineups, rosterId, r.playerId, new Date(`${day}T00:00:00.000Z`)) : null
            return daily ?? weekly
          },
        }
      })
    const idle = findIdleStarts({ mode, days: dayKeys, players, teamPlays, played, isStarterSlot: isNflRedraftScoringStarterSlot, slotAccepts })
    if (idle.length) byRoster.set(rosterId, idle)
  }
  return { mode, byRoster }
}
