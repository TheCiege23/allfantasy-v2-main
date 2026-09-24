import 'server-only'

import { prisma as defaultPrisma } from '@/lib/prisma'

/**
 * HOW OFTEN `import-scores` MAY ASK CFBD — the college feed's third fallback — FOR THE SEASON.
 *
 * Measured on production 2026-09-23 from `sync_job_runs`: of 15,157 `cron-import-scores` runs this
 * month, 13,330 fetched NCAAF, and each such run called CFBD `/games?year=…&seasonType=regular` —
 * the WHOLE regular season — once. That is ~77% of the ~17,400 CFBD calls used this month (the
 * key's own `x-calllimit-remaining` read 57,567 of 75,000). The route's 90-second gate never
 * throttled it: the cron fires every 120 seconds, so the newest row is always older than the gate.
 *
 * CFBD is the LAST provider in the NCAAF chain (ESPN, then TheSportsDB, then CFBD), and ESPN is the
 * only one of the three that reports in-progress state — so CFBD every two minutes bought quota
 * burn, not live scores. ESPN and TheSportsDB are not touched by this module and still run every tick.
 *
 * Rule: during a game window (a college kickoff in the last 5 hours or the next hour) at most every
 * 15 minutes, so finals and corrections still land promptly; otherwise at most every 6 hours, which
 * keeps kickoff-time changes current. Expected: ~12k fewer CFBD calls a month.
 *
 * "Last fetch" is the later of the newest CFBD-sourced SportsGame row (survives a restart) and this
 * process's last ATTEMPT (so a failing or quota-walled CFBD is not retried every tick — a failed
 * call writes no rows, and a DB-only clock would re-fire it forever).
 */

export const CFBD_WINDOW_INTERVAL_MS = 15 * 60 * 1000
export const CFBD_IDLE_INTERVAL_MS = 6 * 60 * 60 * 1000
const WINDOW_BEFORE_MS = 5 * 60 * 60 * 1000
const WINDOW_AFTER_MS = 60 * 60 * 1000

type Db = Pick<typeof defaultPrisma, 'sportsGame'>

let lastAttemptAt: number | null = null

/** Call when CFBD is about to be asked — success or not. */
export function recordCfbdAttempt(now: Date = new Date()): void {
  lastAttemptAt = now.getTime()
}

/** Test seam only. */
export function __resetCfbdThrottleForTests(): void {
  lastAttemptAt = null
}

export type CfbdThrottleDecision = { run: true } | { run: false; reason: string }

/** Pure: given when CFBD was last asked and whether games are on, may it be asked now? */
export function decideCfbdFetch(args: {
  now: Date
  lastFetchedAt: Date | null
  inGameWindow: boolean
}): CfbdThrottleDecision {
  if (!args.lastFetchedAt) return { run: true }
  const interval = args.inGameWindow ? CFBD_WINDOW_INTERVAL_MS : CFBD_IDLE_INTERVAL_MS
  const ageMs = args.now.getTime() - args.lastFetchedAt.getTime()
  if (ageMs >= interval) return { run: true }
  const mins = (ms: number) => Math.round(ms / 60_000)
  return {
    run: false,
    reason: `skipped: CFBD throttled — last asked ${mins(ageMs)}m ago, every ${mins(interval)}m ${args.inGameWindow ? 'during games' : 'outside game windows'}`,
  }
}

/**
 * Reads the two inputs and decides. Any read failure means "run": being unable to check the
 * throttle must never silently stop the feed — it can only cost the calls the throttle saves.
 */
export async function shouldFetchCfbdNow(
  now: Date = new Date(),
  db: Db = defaultPrisma,
): Promise<CfbdThrottleDecision> {
  try {
    const [newest, windowGame] = await Promise.all([
      db.sportsGame.findFirst({
        where: { sport: 'NCAAF', source: 'cfbd' },
        orderBy: { fetchedAt: 'desc' },
        select: { fetchedAt: true },
      }),
      db.sportsGame.findFirst({
        where: {
          sport: 'NCAAF',
          startTime: {
            gte: new Date(now.getTime() - WINDOW_BEFORE_MS),
            lte: new Date(now.getTime() + WINDOW_AFTER_MS),
          },
        },
        select: { id: true },
      }),
    ])
    const fromDb = newest?.fetchedAt?.getTime() ?? null
    const latest = Math.max(fromDb ?? -Infinity, lastAttemptAt ?? -Infinity)
    return decideCfbdFetch({
      now,
      lastFetchedAt: Number.isFinite(latest) ? new Date(latest) : null,
      inGameWindow: windowGame != null,
    })
  } catch {
    return { run: true }
  }
}
