import type { PrismaClient } from '@prisma/client'

import { buildLeagueStatScorer, isScoringStarterSlot } from './scoringEngine'
import {
  dailySlotFor,
  dayKey,
  daysInWindow,
  daysOnRoster,
  droppedInWindow,
  loadDailyLockStarts,
  lockStartOnFor,
  isDailyLineupScoringEnabled,
  loadDailyLineups,
  loadPlayerDailyStats,
} from './dailyLineups'
import { loadWeekLineups, weekSlotType } from './weekLineupSlots'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'

/**
 * The day-by-day picture of one roster's week in a daily-lineup league — for the lineup screen's
 * day picker and the per-player score breakdown. Read-only.
 *
 * It reads each day's slot exactly as the scorer does (`dailySlotFor`, else `weekSlotType`, for the
 * days `daysOnRoster` says he was here), and prices each day's line with the league's own scorer
 * (`buildLeagueStatScorer`, what `calculateScoreFromSportConfig` applies). So `weekPoints` here is
 * the matchup's own number, and a test pins the two together.
 */

export type DailyLineupDay = {
  /** Eastern calendar day, `YYYY-MM-DD`. */
  day: string
  status: 'past' | 'today' | 'future'
  /** playerId → the slot he held that day. Only players on the roster that day. */
  slots: Record<string, string>
  /** playerId → his fantasy points that day, for players with a stat line that day. */
  points: Record<string, number>
  /** Points the day's starters scored. */
  starterPoints: number
}

export type DailyLineupView = {
  week: number
  today: string | null
  days: DailyLineupDay[]
  /** Σ days of starterPoints — the matchup total. */
  weekPoints: number
  /** playerId → his points on the days he STARTED (the breakdown behind `weekPoints`). */
  startedPoints: Record<string, number>
}

type Db = Pick<
  PrismaClient,
  'league' | 'redraftRosterPlayer' | 'redraftDailyLineup' | 'playerDailyScore' | 'roster' | 'afRosterLineupAssignment'
>

const round2 = (n: number) => Math.round(n * 100) / 100

/** `null` unless the league scores daily and the week has a calendar. */
export async function loadDailyLineupView(
  db: Db,
  args: { leagueId: string; redraftRosterId: string; season: number; week: number; now?: Date },
): Promise<DailyLineupView | null> {
  // Optional-chained: a caller's narrow test double without `league` reads as "not daily", as before.
  const league = await db.league?.findFirst?.({ where: { id: args.leagueId }, select: { sport: true, settings: true } })
  const sport = String(league?.sport ?? '').toUpperCase()
  if (!league || !isDailyLineupScoringEnabled(league.settings, sport)) return null
  const window = resolveDailySportWeekWindow(sport, args.season, args.week)
  if (!window) return null
  const scorer = buildLeagueStatScorer({ sport, settings: league.settings })

  const days = daysInWindow(window)
  const today = easternCalendarDay(args.now ?? new Date())
  const players = await db.redraftRosterPlayer.findMany({
    where: { rosterId: args.redraftRosterId, ...droppedInWindow(window) },
  })
  const weekLineups = await loadWeekLineups(db, { redraftRosterIds: [args.redraftRosterId], season: args.season, week: args.week })
  const dailyLineups = await loadDailyLineups(db, { redraftRosterIds: [args.redraftRosterId], window })
  // The scorer's drop/add-day rule, so the view shows exactly the days the score counts.
  const lockStarts = await loadDailyLockStarts(db, { sport, season: args.season, week: args.week })
  const statsBySport = new Map<string, Awaited<ReturnType<typeof loadPlayerDailyStats>>>()
  for (const s of new Set(players.map((p) => p.sport))) {
    statsBySport.set(s, await loadPlayerDailyStats(db, { playerIds: players.map((p) => p.playerId), sport: s, season: args.season, window }))
  }

  const out: DailyLineupDay[] = days.map((d) => ({
    day: dayKey(d),
    status: !today ? 'future' : d.getTime() < today.getTime() ? 'past' : d.getTime() === today.getTime() ? 'today' : 'future',
    slots: {},
    points: {},
    starterPoints: 0,
  }))
  const byKey = new Map(out.map((d) => [d.day, d]))
  const startedPoints: Record<string, number> = {}
  let weekPoints = 0

  for (const p of players) {
    const lines = statsBySport.get(p.sport)?.get(p.playerId)
    for (const d of daysOnRoster(p, days, lockStartOnFor(lockStarts, p))) {
      const entry = byKey.get(dayKey(d))!
      const slot = dailySlotFor(dailyLineups, args.redraftRosterId, p.playerId, d) ?? weekSlotType(p, weekLineups)
      entry.slots[p.playerId] = slot
      const line = lines?.get(dayKey(d))
      if (!line || !scorer) continue
      const raw = scorer(line.stats, p.position)
      entry.points[p.playerId] = round2(raw)
      if (isScoringStarterSlot(slot)) {
        entry.starterPoints = round2(entry.starterPoints + raw)
        startedPoints[p.playerId] = round2((startedPoints[p.playerId] ?? 0) + raw)
        // Summed unrounded and rounded once, as the matchup scorer does.
        weekPoints += raw
      }
    }
  }

  return { week: args.week, today: today ? dayKey(today) : null, days: out, weekPoints: round2(weekPoints), startedPoints }
}
