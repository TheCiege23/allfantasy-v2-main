import type { Prisma, PrismaClient } from '@prisma/client'

import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { buildWeekKickoffMap, lockTeamLookupKeys, readLineupLockSettings } from './lineupLock'

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
 * `before` — the slots the save REPLACED — fills the week's EARLIER days that have no rows yet. Every
 * save writes rows, so a day with none had no save on or before it this week, and the lineup in force
 * that day was exactly the one this save replaces. Earlier days that already have rows are history and
 * are never touched. (Ported from #2539, which the owner closed in favour of this PR.)
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
    /** playerId → slotType before the save, for back-filling the week's earlier days. */
    before?: ReadonlyMap<string, string>
  },
): Promise<{ days: number; rows: number; backfilledDays?: number }> {
  const window = resolveDailySportWeekWindow(args.sport, args.season, args.week)
  if (!window) {
    throw new Error(
      `Daily lineups are on for this league, but ${args.sport} ${args.season} week ${args.week} has no date window. ` +
        'Record the season opener in lib/season-week/dailySportSeasonStarts.ts.',
    )
  }
  const days = daysDecidedBySave(window, args.now ?? new Date())
  if (days.length === 0) return { days: 0, rows: 0 }

  let backfilled: Record<string, unknown>[] = []
  let backfilledDays = 0
  const earlier = daysInWindow(window).filter((d) => d.getTime() < days[0].getTime())
  if (args.before && args.before.size > 0 && earlier.length > 0) {
    const existing = await tx.redraftDailyLineup.findMany({
      where: { rosterId: args.redraftRosterId, scoringDay: { gte: earlier[0], lt: days[0] } },
      select: { scoringDay: true },
      distinct: ['scoringDay'],
    })
    const withRows = new Set(existing.map((r) => dayKey(r.scoringDay)))
    const missing = earlier.filter((d) => !withRows.has(dayKey(d)))
    backfilledDays = missing.length
    backfilled = missing.flatMap((scoringDay) =>
      [...args.before!].map(([playerId, slotType]) => ({
        leagueId: args.leagueId,
        rosterId: args.redraftRosterId,
        season: args.season,
        week: args.week,
        scoringDay,
        playerId,
        slotType,
        source: args.source ?? 'user',
      })),
    )
  }

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
  const all = [...backfilled, ...data] as typeof data
  if (all.length) await tx.redraftDailyLineup.createMany({ data: all })
  return { days: days.length, rows: data.length, ...(backfilledDays ? { backfilledDays } : {}) }
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

/**
 * The week's days a player was on the roster: added on or before the day, and not dropped before it.
 *
 * 🛑 A DROP ON DAY D STILL COUNTS D, AND THE DAYS BEFORE IT COUNT TOO. A reader that loads only
 * `droppedAt: null` rows lets a manager start a player on Tuesday, drop him after a bad game, and
 * take Tuesday off the score — the B5 exploit reached through a drop instead of a bench move.
 * Callers load rows dropped inside the window as well (`droppedInWindow`), and this decides which
 * of his days still count.
 *
 * THE DAY OF A DROP OR AN ADD IS DECIDED BY HIS GAME'S LOCK (owner's delegate, 2026-10-27), when
 * `lockStartOn` names it — his team's first game start that Eastern day (`loadDailyLockStarts`):
 *   - dropped AT OR AFTER the lock: the day stays the dropping team's — earned points never move;
 *   - dropped BEFORE the lock: the day is not the dropping team's — his points count for nobody,
 *     unless another team adds and starts him before the lock;
 *   - added AT OR AFTER the lock: the day is not the adding team's, so a game is never scored twice.
 * No known lock (no game that day, an unresolved team, an unread schedule) keeps the whole-day rule
 * above: a day without a game carries no points either way, and an unread schedule must never take
 * an earned game off a score.
 */
export function daysOnRoster(
  player: { addedAt?: Date | null; droppedAt?: Date | null },
  days: readonly Date[],
  lockStartOn?: (day: Date) => Date | null,
): Date[] {
  const joined = player.addedAt ? easternCalendarDay(player.addedAt) : null
  const left = player.droppedAt ? easternCalendarDay(player.droppedAt) : null
  return days.filter((d) => {
    if (joined && d.getTime() < joined.getTime()) return false
    if (left && d.getTime() > left.getTime()) return false
    const addDay = joined != null && d.getTime() === joined.getTime()
    const dropDay = left != null && d.getTime() === left.getTime()
    const lock = lockStartOn && (addDay || dropDay) ? lockStartOn(d) : null
    if (!lock) return true
    if (addDay && player.addedAt!.getTime() >= lock.getTime()) return false
    if (dropDay && player.droppedAt!.getTime() < lock.getTime()) return false
    return true
  })
}

/** `(team, day)` → his team's first game start that Eastern day, or null when none is known. */
export type DailyLockStarts = (team: string | null | undefined, day: Date) => Date | null

/**
 * The per-day lock instants the daily lineup lock enforces (`buildWeekKickoffMap(...).byTeamDay`,
 * looked up under the same team keys), for `daysOnRoster`'s drop/add-day rule. Null when the
 * schedule cannot be read: the callers then keep the whole-day rule rather than fail a score.
 */
export async function loadDailyLockStarts(
  db: unknown,
  args: { sport: string; season: number; week: number },
): Promise<DailyLockStarts | null> {
  try {
    const kickoffs = await buildWeekKickoffMap(db as PrismaClient, args)
    const byTeamDay = kickoffs?.byTeamDay
    if (!byTeamDay || byTeamDay.size === 0) return null
    return (team, day) => {
      const key = dayKey(day)
      for (const k of lockTeamLookupKeys(args.sport, team)) {
        const start = byTeamDay.get(k)?.get(key)
        if (start) return start
      }
      return null
    }
  } catch (err) {
    console.warn(`[dailyLineups] ${args.sport} ${args.season} week ${args.week}: lock starts unreadable, drop and add days count whole`, err)
    return null
  }
}

/** `daysOnRoster`'s third argument for one roster row, or undefined without lock starts. */
export function lockStartOnFor(
  lockStarts: DailyLockStarts | null | undefined,
  player: { team?: string | null },
): ((day: Date) => Date | null) | undefined {
  return lockStarts ? (day) => lockStarts(player.team ?? null, day) : undefined
}

/** The roster-player filter for a daily week: still rostered, or dropped during the window. */
export function droppedInWindow(window: { start: Date; end: Date }) {
  return { OR: [{ droppedAt: null }, { droppedAt: { gte: window.start } }] }
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
