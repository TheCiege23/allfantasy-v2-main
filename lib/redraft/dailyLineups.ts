import type { Prisma, PrismaClient } from '@prisma/client'

import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { readLineupLockSettings } from './lineupLock'

/**
 * DAILY LINEUPS — phases B and C of docs/DAILY_LINEUPS_DESIGN.md.
 *
 * A daily-lineup league (MLB/NBA/NHL, `sportConfig.lineupLockType: 'daily'` AND
 * `sportConfig.dailyLineupsEnabled: true`) scores each US Eastern day's starters on that day's stats,
 * and the matchup total is the sum over the week's days. Owner's rules, 2026-10-19:
 *   - scoring is the daily sum,
 *   - each player locks at his own game start,
 *   - a player who has played stays locked for the rest of that day (the daily lock mode).
 *
 * 🛑 THE PER-DAY TABLES ARE TOUCHED ONLY WHEN THE LEAGUE IS ENABLED. They arrive with migration
 * `20261020120000_daily_lineups`, and code that queries a table production lacks raises P2021 —
 * it does not no-op. Every reader and writer here is behind `isDailyLineupScoringEnabled`, which
 * nothing turns on until the migration is applied.
 *
 * Days are UTC-midnight `Date` keys of the Eastern calendar day — the same form `game_date` and the
 * week window (`resolveDailySportWeekWindow`) use, so the three line up without conversion.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** True only when the league is in the real daily lock mode — the same three-part gate the lock reads. */
export function isDailyLineupScoringEnabled(leagueSettings: unknown, sport: string | null | undefined): boolean {
  if (!sport) return false
  return readLineupLockSettings(leagueSettings, sport).mode === 'daily'
}

export function dayKey(day: Date): string {
  return day.toISOString().slice(0, 10)
}

/** Every day key in `[start, end)`. */
export function daysInWindow(window: { start: Date; end: Date }): Date[] {
  const out: Date[] = []
  for (let t = window.start.getTime(); t < window.end.getTime(); t += DAY_MS) out.push(new Date(t))
  return out
}

/**
 * The days a save made at `now` decides: from today (Eastern) — or the week's first day, for a save
 * made ahead of the week — through the week's last day. A save for a week already over decides none.
 * Today is included: the daily lock has already refused any move of a player whose game started.
 */
export function daysDecidedBySave(window: { start: Date; end: Date }, now: Date): Date[] {
  const today = easternCalendarDay(now)
  if (!today) return []
  const from = Math.max(today.getTime(), window.start.getTime())
  return daysInWindow(window).filter((d) => d.getTime() >= from)
}

type DailyLineupWriteDb = Pick<Prisma.TransactionClient, 'redraftRosterPlayer' | 'redraftDailyLineup'>

/**
 * Record the roster's CURRENT slots (read inside the caller's transaction, after its own update) for
 * every day the save decides. Replaces those days wholesale so a player dropped since the last save
 * does not linger as a starter. Call only for an enabled league (`isDailyLineupScoringEnabled`).
 *
 * Throws when the week has no date window: in an enabled league a lineup that cannot be pinned to its
 * days would be scored on the weekly lineup, and a lock that resets daily makes that an exploit
 * (design §3 B5). Refusing the save is the safe failure.
 */
export async function writeDailyLineupForSave(
  tx: DailyLineupWriteDb,
  args: {
    leagueId: string
    redraftRosterId: string
    sport: string
    season: number
    week: number
    now?: Date
    source?: string
  },
): Promise<{ days: number; rows: number }> {
  const window = resolveDailySportWeekWindow(args.sport, args.season, args.week)
  if (!window) {
    throw new Error(
      `Daily lineups are on for this league, but ${args.sport} ${args.season} week ${args.week} has no date window. ` +
        'Record the season opener in lib/season-week/dailySportSeasonStarts.ts.',
    )
  }
  const days = daysDecidedBySave(window, args.now ?? new Date())
  if (days.length === 0) return { days: 0, rows: 0 }

  const players = await tx.redraftRosterPlayer.findMany({
    where: { rosterId: args.redraftRosterId, droppedAt: null },
    select: { playerId: true, slotType: true },
  })
  await tx.redraftDailyLineup.deleteMany({
    where: { rosterId: args.redraftRosterId, scoringDay: { gte: days[0], lte: days[days.length - 1] } },
  })
  const data = days.flatMap((scoringDay) =>
    players.map((p) => ({
      leagueId: args.leagueId,
      rosterId: args.redraftRosterId,
      season: args.season,
      week: args.week,
      scoringDay,
      playerId: p.playerId,
      slotType: p.slotType,
      source: args.source ?? 'user',
    })),
  )
  if (data.length) await tx.redraftDailyLineup.createMany({ data })
  return { days: days.length, rows: data.length }
}

/** redraftRosterId → playerId → (dayKey → slotType), only the days that have a saved row. */
export type DailyLineups = Map<string, Map<string, Map<string, string>>>

export async function loadDailyLineups(
  db: Pick<PrismaClient, 'redraftDailyLineup'>,
  args: { redraftRosterIds: readonly string[]; window: { start: Date; end: Date } },
): Promise<DailyLineups> {
  const out: DailyLineups = new Map()
  if (args.redraftRosterIds.length === 0) return out
  // From before the window too: a day with no row carries forward the latest earlier save.
  const rows = await db.redraftDailyLineup.findMany({
    where: { rosterId: { in: [...args.redraftRosterIds] }, scoringDay: { lt: args.window.end } },
    select: { rosterId: true, playerId: true, scoringDay: true, slotType: true },
  })
  for (const r of rows) {
    const byPlayer = out.get(r.rosterId) ?? new Map<string, Map<string, string>>()
    const byDay = byPlayer.get(r.playerId) ?? new Map<string, string>()
    byDay.set(dayKey(r.scoringDay), r.slotType)
    byPlayer.set(r.playerId, byDay)
    out.set(r.rosterId, byPlayer)
  }
  return out
}

/**
 * The slot a player held on `day`: his own row for that day, else his latest earlier row. `null` when
 * the roster has never saved a daily lineup naming him — the caller falls back to the weekly lineup.
 */
export function dailySlotFor(lineups: DailyLineups, rosterId: string, playerId: string, day: Date): string | null {
  const byDay = lineups.get(rosterId)?.get(playerId)
  if (!byDay) return null
  const key = dayKey(day)
  const exact = byDay.get(key)
  if (exact != null) return exact
  let best: string | null = null
  let bestKey = ''
  for (const [k, slot] of byDay) {
    if (k < key && k > bestKey) {
      bestKey = k
      best = slot
    }
  }
  return best
}

/** playerId → dayKey → that day's summed stats. */
export type PlayerDailyStats = Map<string, Map<string, { stats: Record<string, number>; isFinalized: boolean }>>

export async function loadPlayerDailyStats(
  db: Pick<PrismaClient, 'playerDailyScore'>,
  args: { playerIds: readonly string[]; sport: string; season: number; window: { start: Date; end: Date } },
): Promise<PlayerDailyStats> {
  const out: PlayerDailyStats = new Map()
  if (args.playerIds.length === 0) return out
  const rows = await db.playerDailyScore.findMany({
    where: {
      playerId: { in: [...args.playerIds] },
      sport: args.sport,
      season: args.season,
      scoringDay: { gte: args.window.start, lt: args.window.end },
    },
    select: { playerId: true, scoringDay: true, stats: true, isFinalized: true },
  })
  for (const r of rows) {
    const byDay = out.get(r.playerId) ?? new Map()
    byDay.set(dayKey(r.scoringDay), { stats: (r.stats ?? {}) as Record<string, number>, isFinalized: r.isFinalized })
    out.set(r.playerId, byDay)
  }
  return out
}
