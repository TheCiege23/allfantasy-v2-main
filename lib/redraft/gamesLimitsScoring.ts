import type { PrismaClient } from '@prisma/client'

import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { isNflRedraftScoringStarterSlot } from '@/lib/scoring-runtime'
import { normalizeToken } from '@/lib/redraft/lineupValidation'
import { dailySlotFor, dayKey, daysInWindow, daysOnRoster, loadDailyLineups } from './dailyLineups'
import { loadWeekLineups, weekSlotType } from './weekLineupSlots'
import type { LimitLedgerEntry } from './gamesLimits'

/**
 * The DB half of the games-limits step (pure rules: `gamesLimits.ts`). Everything here is read from rows
 * the daily-lineup league already stores — `redraft_daily_lineups`, the weekly lineup it falls back to,
 * and `player_daily_scores` — so a season's cap usage is recomputed deterministically on every scoring
 * run and nothing new is persisted.
 */

type Db = Pick<
  PrismaClient,
  'redraftRosterPlayer' | 'redraftDailyLineup' | 'playerDailyScore' | 'roster' | 'afRosterLineupAssignment'
>

/** Normalized position tokens: `PG/SG` → ['PG', 'SG']. */
export function positionTokens(position: string | null | undefined): string[] {
  return String(position ?? '')
    .split(/[/,]/)
    .map((p) => normalizeToken(p))
    .filter(Boolean)
}

/** The cap key for a starter slot. A generic `starter` row (weekly section only) counts at his position. */
export function capSlotKey(slot: string | null | undefined, position: string | null | undefined): string {
  const token = normalizeToken(slot)
  return token === 'STARTER' ? positionTokens(position)[0] ?? token : token
}

/** playerId → dayKey → games played that day (the sync's per-day `gamesPlayed`). */
export async function loadDailyGamesPlayed(
  db: Pick<PrismaClient, 'playerDailyScore'>,
  args: { playerIds: readonly string[]; sport: string; season: number; window: { start: Date; end: Date } },
): Promise<Map<string, Map<string, { gamesPlayed: number; stats: Record<string, number> }>>> {
  const out = new Map<string, Map<string, { gamesPlayed: number; stats: Record<string, number> }>>()
  if (args.playerIds.length === 0) return out
  const rows = await db.playerDailyScore.findMany({
    where: {
      playerId: { in: [...args.playerIds] },
      sport: args.sport,
      season: args.season,
      scoringDay: { gte: args.window.start, lt: args.window.end },
    },
    select: { playerId: true, scoringDay: true, gamesPlayed: true, stats: true },
  })
  for (const r of rows) {
    const byDay = out.get(r.playerId) ?? new Map()
    byDay.set(dayKey(r.scoringDay), { gamesPlayed: r.gamesPlayed, stats: (r.stats ?? {}) as Record<string, number> })
    out.set(r.playerId, byDay)
  }
  return out
}

/**
 * Every starter-day of the season BEFORE `week` for one roster, with the same slot resolution the daily
 * scorer uses (that day's row → latest earlier row → the week's lineup) and the same roster-membership
 * rule (`daysOnRoster`). Only the caps read it, so callers skip it when no cap is set.
 */
export async function loadPriorSeasonLedger(
  db: Db,
  args: { rosterId: string; sport: string; season: number; week: number },
): Promise<LimitLedgerEntry[]> {
  const first = resolveDailySportWeekWindow(args.sport, args.season, 1)
  const current = resolveDailySportWeekWindow(args.sport, args.season, args.week)
  if (!first || !current || args.week <= 1) return []
  const seasonBefore = { start: first.start, end: current.start }

  const players = await db.redraftRosterPlayer.findMany({
    where: { rosterId: args.rosterId, OR: [{ droppedAt: null }, { droppedAt: { gte: first.start } }] },
  })
  if (players.length === 0) return []
  const playerIds = [...new Set(players.map((p) => p.playerId))]
  const dailyLineups = await loadDailyLineups(db, { redraftRosterIds: [args.rosterId], window: seasonBefore })
  const games = new Map<string, Awaited<ReturnType<typeof loadDailyGamesPlayed>>>()
  for (const sport of new Set(players.map((p) => p.sport))) {
    games.set(sport, await loadDailyGamesPlayed(db, { playerIds, sport, season: args.season, window: seasonBefore }))
  }

  const ledger: LimitLedgerEntry[] = []
  // A player dropped and re-added on one day has two rows that both cover it; count the day once.
  const seen = new Set<string>()
  for (let w = 1; w < args.week; w++) {
    const window = resolveDailySportWeekWindow(args.sport, args.season, w)
    if (!window) continue
    const weekLineups = await loadWeekLineups(db, { redraftRosterIds: [args.rosterId], season: args.season, week: w })
    const days = daysInWindow(window)
    for (const p of players) {
      for (const day of daysOnRoster(p, days)) {
        const line = games.get(p.sport)?.get(p.playerId)?.get(dayKey(day))
        if (!line || line.gamesPlayed <= 0) continue
        const slot = dailySlotFor(dailyLineups, args.rosterId, p.playerId, day) ?? weekSlotType(p, weekLineups)
        if (!isNflRedraftScoringStarterSlot(slot)) continue
        const key = `${p.playerId}|${dayKey(day)}`
        if (seen.has(key)) continue
        seen.add(key)
        ledger.push({
          day: dayKey(day),
          playerId: p.playerId,
          slot: capSlotKey(slot, p.position),
          positions: positionTokens(p.position),
          gamesPlayed: line.gamesPlayed,
          stats: line.stats,
        })
      }
    }
  }
  return ledger
}
