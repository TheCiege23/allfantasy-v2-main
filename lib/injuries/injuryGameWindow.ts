import { prisma } from '@/lib/prisma'

/**
 * Is this the window where an NFL injury update changes a lineup decision?
 *
 * The inactive list lands ~90 minutes before each kickoff (11:30a ET for the 1:00 slate), and late
 * scratches keep coming until the ball is kicked. Measured on production 2026-09-20: new ESPN injury
 * rows arrived at 11:30, 11:45 and 12:30 ET — a 45-minute hole, on a 30-minute cron, across the
 * hour the game-day list exists for. The `gameWindow=1` run of /api/cron/import-injuries fires every
 * five minutes and does real work only inside this window; outside it, it returns at once.
 *
 * WINDOW: some NFL game kicks off within the next 150 minutes, or kicked off within the last 30.
 * That covers every slate — Thursday, the Sunday 1:00 / 4:05 / 4:25 / 8:20 waves, Monday, and
 * international mornings — from the schedule itself, with no clock table to go stale.
 */
export const WINDOW_BEFORE_KICKOFF_MS = 150 * 60_000
export const WINDOW_AFTER_KICKOFF_MS = 30 * 60_000

/** Pure: the [from, to] range of kickoff times that puts `now` inside a game window. */
export function kickoffRangeForWindow(now: Date): { from: Date; to: Date } {
  return { from: new Date(now.getTime() - WINDOW_AFTER_KICKOFF_MS), to: new Date(now.getTime() + WINDOW_BEFORE_KICKOFF_MS) }
}

/** One indexed read. A read failure answers true: an extra five-minute poll is cheap, a missed inactive is not. */
export async function inNflInjuryGameWindow(now: Date = new Date()): Promise<boolean> {
  const { from, to } = kickoffRangeForWindow(now)
  try {
    const game = await prisma.sportsGame.findFirst({
      where: { sport: 'NFL', startTime: { gte: from, lte: to } },
      select: { id: true },
    })
    return game !== null
  } catch {
    return true
  }
}
