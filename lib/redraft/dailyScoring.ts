import type { PrismaClient } from '@prisma/client'

import { dailyLineupsActive, weekScoringDays } from '@/lib/redraft/dailyLineupStore'
import { weekSlotType, type WeekLineups } from '@/lib/redraft/weekLineupSlots'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'

/**
 * WHO STARTED ON WHICH DAY, for a daily-lineup league (Phase C of docs/DAILY_LINEUPS_DESIGN.md).
 *
 * A weekly league scores each starter's WHOLE-week total for whoever holds the slot when the week is
 * scored. A daily league scores Σ over the week's Eastern days of Σ over THAT day's starters of THAT
 * player's points on that day — so moving a player only ever changes the days still to come.
 *
 * The lineup for day D is, in order:
 *   1. the `redraft_daily_lineups` rows saved for D;
 *   2. else the rows of the latest EARLIER day of the week that has rows (a lineup set once is kept);
 *   3. else the week's lineup as weekly scoring reads it (`weekSlotType`) — a week nobody has saved yet.
 *
 * A player counts on D only while he was on the roster that day: added on or before D, and not dropped
 * before D. A drop ON day D still counts D, so dropping a player after a bad game cannot erase it.
 */

export type DailyRosterPlayer = {
  rosterId: string
  playerId: string
  position: string
  sport: string
  slotType: string
  addedAt?: Date | null
  droppedAt?: Date | null
}

export type DailySlot<P extends DailyRosterPlayer = DailyRosterPlayer> = { day: Date; player: P; slotType: string }

const dayKey = (d: Date) => d.toISOString().slice(0, 10)

/** Was this player on the roster on scoring day `day` (UTC-midnight DATE key)? */
export function onRosterOnDay(player: Pick<DailyRosterPlayer, 'addedAt' | 'droppedAt'>, day: Date): boolean {
  const added = player.addedAt ? easternCalendarDay(player.addedAt) : null
  if (added && added.getTime() > day.getTime()) return false
  const dropped = player.droppedAt ? easternCalendarDay(player.droppedAt) : null
  if (dropped && dropped.getTime() < day.getTime()) return false
  return true
}

/** Every (day, player, slot) for one roster's week. Pure. */
export function expandDailySlots<P extends DailyRosterPlayer>(input: {
  days: readonly Date[]
  players: readonly P[]
  /** dayKey → playerId → slotType, from `redraft_daily_lineups`. */
  savedByDay: ReadonlyMap<string, ReadonlyMap<string, string>>
  fallbackSlot: (player: P) => string
}): DailySlot<P>[] {
  const out: DailySlot<P>[] = []
  let carried: ReadonlyMap<string, string> | null = null
  for (const day of input.days) {
    carried = input.savedByDay.get(dayKey(day)) ?? carried
    for (const player of input.players) {
      if (!onRosterOnDay(player, day)) continue
      // A player the saved lineup does not name (added after that save) sits on the bench.
      const slotType = carried ? (carried.get(player.playerId) ?? 'bench') : input.fallbackSlot(player)
      out.push({ day, player, slotType })
    }
  }
  return out
}

/** The week's days and every roster's per-day slots, or `null` when the week has no calendar. */
export async function loadDailySlotsForWeek<P extends DailyRosterPlayer>(
  db: Pick<PrismaClient, 'redraftDailyLineup'>,
  args: { sport: string; season: number; week: number; players: readonly P[]; weekLineups: WeekLineups },
): Promise<{ window: { start: Date; end: Date }; days: Date[]; slots: DailySlot<P>[] } | null> {
  const window = resolveDailySportWeekWindow(args.sport, args.season, args.week)
  if (!window) return null
  const days = weekScoringDays(window)
  const rosterIds = [...new Set(args.players.map((p) => p.rosterId))]
  const rows = rosterIds.length
    ? await db.redraftDailyLineup.findMany({
        where: { rosterId: { in: rosterIds }, scoringDay: { gte: window.start, lt: window.end } },
        select: { rosterId: true, scoringDay: true, playerId: true, slotType: true },
      })
    : []
  const savedByRoster = new Map<string, Map<string, Map<string, string>>>()
  for (const r of rows) {
    const byDay = savedByRoster.get(r.rosterId) ?? new Map<string, Map<string, string>>()
    const slots = byDay.get(dayKey(r.scoringDay)) ?? new Map<string, string>()
    slots.set(r.playerId, r.slotType)
    byDay.set(dayKey(r.scoringDay), slots)
    savedByRoster.set(r.rosterId, byDay)
  }
  const slots: DailySlot<P>[] = []
  for (const rosterId of rosterIds) {
    slots.push(
      ...expandDailySlots({
        days,
        players: args.players.filter((p) => p.rosterId === rosterId),
        savedByDay: savedByRoster.get(rosterId) ?? new Map(),
        fallbackSlot: (p) => weekSlotType(p, args.weekLineups),
      }),
    )
  }
  return { window, days, slots }
}

/** The league's sport when it scores its weeks day by day, else `null`. One read. */
export async function leagueScoresDaily(
  db: Pick<PrismaClient, 'league'>,
  leagueId: string,
): Promise<{ sport: string } | null> {
  const league = await db.league?.findUnique?.({ where: { id: leagueId }, select: { settings: true, sport: true } })
  const sport = league?.sport ? String(league.sport).toUpperCase() : null
  return sport && dailyLineupsActive(league?.settings, sport) ? { sport } : null
}
