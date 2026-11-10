import { prisma } from '@/lib/prisma'

/**
 * Should THIS fire of the NFL week-stats import run? (2026-11-09, live box scores on game days.)
 *
 * `/api/cron/import-player-game-stats` used to fire once a day at 06:40 UTC, so a Sunday box score
 * reached the Matchup board on Monday morning. It now fires hourly through the NFL windows
 * (`40 0-6,13-23 * * *` in cron-schedule.json) — folded into the existing slot because the registry
 * sits at its 60-job ceiling — and this gate decides which fires do work:
 *
 *   explicit   — the caller named a season, week or cap: always run, exactly as before
 *   game       — a regular-season NFL game kicked off in the last LIVE_WINDOW_MS: run, so the week
 *                being played is re-fetched (findWeeksNeedingWork keeps an unsettled week "missing")
 *   daily      — no successful run in the last DAILY_FLOOR_MS: run, so the once-a-day import still
 *                happens even when GitHub's scheduler delays or drops the 06:40 fire
 *   otherwise  — skip, before the lock and before any provider call
 *
 * The importer is unchanged. Live fires use the FULL pipeline (stats and facts): a week whose stats
 * and facts disagree is classified `partial`, and a partial week is only facts-repaired, never
 * re-fetched — so a stats-only live fire would have stopped the next run fetching Sunday night's game.
 */
export const LIVE_WINDOW_MS = 5 * 60 * 60 * 1000
export const DAILY_FLOOR_MS = 20 * 60 * 60 * 1000

export type NflStatsRunReason = 'explicit' | 'game' | 'daily'
export type NflStatsRunDecision = { run: true; reason: NflStatsRunReason } | { run: false; reason: 'no_game_window' }

export function decideNflStatsRun(args: {
  now: Date
  explicit: boolean
  /** The newest regular-season kickoff at or before `now`, or null when none is stored. */
  latestKickoff: Date | null
  /** When the importer last finished successfully, or null when it never has (or the read failed). */
  lastSuccessAt: Date | null
}): NflStatsRunDecision {
  if (args.explicit) return { run: true, reason: 'explicit' }
  const now = args.now.getTime()
  if (args.latestKickoff && now - args.latestKickoff.getTime() <= LIVE_WINDOW_MS) return { run: true, reason: 'game' }
  // Unknown is treated as "due": a failed read must never be what stops the daily import.
  if (!args.lastSuccessAt || now - args.lastSuccessAt.getTime() >= DAILY_FLOOR_MS) return { run: true, reason: 'daily' }
  return { run: false, reason: 'no_game_window' }
}

/** The two reads `decideNflStatsRun` needs. Either failing reads as null, which errs toward running. */
export async function loadNflStatsRunFacts(jobName: string, now: Date): Promise<{ latestKickoff: Date | null; lastSuccessAt: Date | null }> {
  const [game, run] = await Promise.all([
    prisma.sportsGame
      .findFirst({
        where: { sport: 'NFL', seasonType: 'regular', startTime: { lte: now, gte: new Date(now.getTime() - LIVE_WINDOW_MS) } },
        orderBy: { startTime: 'desc' },
        select: { startTime: true },
      })
      .catch(() => null),
    prisma.syncJobRun
      .findFirst({
        where: { jobName, status: 'success', completedAt: { not: null } },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      })
      .catch(() => null),
  ])
  return { latestKickoff: game?.startTime ?? null, lastSuccessAt: run?.completedAt ?? null }
}
