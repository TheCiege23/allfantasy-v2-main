import type { Prisma } from '@prisma/client'

import { engineLineupView, idsOnAnyRosterList, slotTypeFor } from '@/lib/league-runtime/redraftSlotType'
import { readLineupLockSettings } from '@/lib/redraft/lineupLock'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'

/**
 * Record WHO SAT WHERE ON EACH DAY, for a daily-lineup league (Phase B of docs/DAILY_LINEUPS_DESIGN.md).
 *
 * 🛑 THE RULE A SAVE FOLLOWS, AND WHY IT IS EXACT. A save on Eastern day D of week W writes:
 *   - D and every later day of W → the lineup AFTER the save. A manager who sets it once keeps it.
 *   - every EARLIER day of W that has no rows yet → the lineup BEFORE the save. Every save writes rows,
 *     so a day with none had no save on or before it this week, and the lineup in force that day was
 *     exactly the one this save replaces.
 *   - earlier days that already have rows → untouched. They are history.
 *
 * Today is rewritten in full, which is safe only because the save path has already refused to move a
 * player whose game today has started (`daily` lock mode), so his row for today cannot change.
 *
 * ⚠ GATED ON `dailyLineupsActive`, NOT ON THE SPORT. Only a league whose lock mode resolves to `daily`
 * (lineupLockType 'daily' + dailyLineupsEnabled + NBA/NHL/MLB) writes here. Every other league never
 * touches the table, so this ships safely ahead of the migration that creates it.
 */

/** True when this league's lineups are kept per day. */
export function dailyLineupsActive(leagueSettings: unknown, sport: string | null | undefined): boolean {
  if (!sport) return false
  return readLineupLockSettings(leagueSettings, sport).mode === 'daily'
}

const DAY_MS = 86_400_000

/** The Eastern scoring days of a week, as UTC-midnight DATE keys. */
export function weekScoringDays(window: { start: Date; end: Date }): Date[] {
  const days: Date[] = []
  for (let t = window.start.getTime(); t < window.end.getTime(); t += DAY_MS) days.push(new Date(t))
  return days
}

export type DailyLineupRow = { scoringDay: Date; playerId: string; slotType: string }

/** A roster's slot per player from its `playerData`, for the players the scoring rows name. */
export function slotMapFromPlayerData(
  playerData: unknown,
  players: ReadonlyArray<{ playerId: string; position: string | null }>,
): Map<string, string> {
  const view = engineLineupView(playerData)
  const onRoster = idsOnAnyRosterList(view)
  const out = new Map<string, string>()
  for (const p of players) {
    if (!onRoster.has(p.playerId)) continue
    out.set(p.playerId, slotTypeFor(view, p.playerId, p.position))
  }
  return out
}

/**
 * The rows a save writes. `daysWithRows` is the set of `scoringDay` keys (ISO date) that already hold
 * rows for this roster; `replaceDays` is what the caller must clear before inserting.
 */
export function planDailyLineupSave(input: {
  days: readonly Date[]
  today: Date
  daysWithRows: ReadonlySet<string>
  before: ReadonlyMap<string, string>
  after: ReadonlyMap<string, string>
}): { rows: DailyLineupRow[]; replaceDays: Date[] } {
  const rows: DailyLineupRow[] = []
  const replaceDays: Date[] = []
  const emit = (day: Date, slots: ReadonlyMap<string, string>) => {
    for (const [playerId, slotType] of slots) rows.push({ scoringDay: day, playerId, slotType })
  }
  for (const day of input.days) {
    if (day.getTime() >= input.today.getTime()) {
      replaceDays.push(day)
      emit(day, input.after)
    } else if (!input.daysWithRows.has(day.toISOString().slice(0, 10))) {
      emit(day, input.before)
    }
  }
  return { rows, replaceDays }
}

/**
 * Write a lineup save's per-day rows inside the caller's transaction. Returns `skipped` (with why) when
 * the week has no verified calendar — the save itself still succeeds, as it does for weekly leagues.
 */
export async function writeDailyLineupSave(
  tx: Prisma.TransactionClient,
  input: {
    leagueId: string
    redraftRosterId: string
    sport: string
    season: number
    week: number
    before: ReadonlyMap<string, string>
    after: ReadonlyMap<string, string>
    now?: Date
    source?: string
  },
): Promise<{ written: number; skipped?: string }> {
  const window = resolveDailySportWeekWindow(input.sport, input.season, input.week)
  if (!window) return { written: 0, skipped: 'no week calendar' }
  const today = easternCalendarDay(input.now ?? new Date())
  if (!today) return { written: 0, skipped: 'no current day' }
  const days = weekScoringDays(window)

  const existing = await tx.redraftDailyLineup.findMany({
    where: { rosterId: input.redraftRosterId, scoringDay: { gte: window.start, lt: window.end } },
    select: { scoringDay: true },
    distinct: ['scoringDay'],
  })
  const daysWithRows = new Set(existing.map((r) => r.scoringDay.toISOString().slice(0, 10)))
  const plan = planDailyLineupSave({ days, today, daysWithRows, before: input.before, after: input.after })

  if (plan.replaceDays.length > 0) {
    await tx.redraftDailyLineup.deleteMany({
      where: { rosterId: input.redraftRosterId, scoringDay: { in: plan.replaceDays } },
    })
  }
  if (plan.rows.length === 0) return { written: 0 }
  await tx.redraftDailyLineup.createMany({
    data: plan.rows.map((r) => ({
      leagueId: input.leagueId,
      rosterId: input.redraftRosterId,
      season: input.season,
      week: input.week,
      scoringDay: r.scoringDay,
      playerId: r.playerId,
      slotType: r.slotType,
      source: input.source ?? 'user',
    })),
    skipDuplicates: true,
  })
  return { written: plan.rows.length }
}
