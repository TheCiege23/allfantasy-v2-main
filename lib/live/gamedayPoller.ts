import { prisma } from '@/lib/prisma'
import { normaliseStatus } from './rollingInsightsAdapter'

/**
 * Game-day polling budget for a single cron invocation.
 *
 * ⚠ VERCEL CRON CANNOT DO 35 SECONDS. Its granularity is one minute, and
 * INTEGRATION.md §4 asks for 35s on `/live` and `/play-by-play` while a game is
 * in progress (vendor floor is 5s, so 35s is deliberate headroom rather than a
 * limit). The resolution is that ONE invocation polls several times inside its
 * own lifetime, instead of one invocation per poll.
 *
 * ⚠ THE BUDGET IS SIZED TO THE CRON INTERVAL, AND THAT SIZING IS THE WHOLE
 * DESIGN. `live-score-tick` runs on a two-minute cron — a 120s window. Polling for ~105s leaves
 * ~15s of margin, so invocation N finishes before N+1 starts. Get this wrong in
 * the other direction — a 300s loop on a two-minute cron — and you get eight
 * overlapping invocations all polling the same endpoint, which is worse than not
 * polling at all. If the cron interval ever changes, this constant changes with
 * it.
 *
 * ⚠ IT SELF-GATES ON REAL GAMES, NOT ON A CALENDAR. With nothing in progress the
 * loop exits after its first pass, so a Tuesday costs one tick and a Sunday runs
 * hot. That is why this can sit on a frequent cron without burning anything.
 */

/**
 * Poll cadence while a game is in progress.
 *
 * ⚠ SCORES AND PLAYS DO NOT COST THE SAME, SO THEY DO NOT SHARE A CADENCE.
 * `/live` returns the ENTIRE slate in one call, so polling it harder costs one
 * request no matter how many games are on. `/play-by-play` needs a game_id, so
 * it costs one request PER LIVE GAME per pass — on a 13-game Sunday that is 13×
 * the price for the same interval.
 *
 * So scores run fast and plays run at the contract's 35s. For reference, the
 * industry floor is 3–5s (SportsData.io publishes that, and caches for a
 * minimum of 3s, so nobody on that feed is fresher). We sit above it
 * deliberately: Rolling Insights recommends at least 5s between calls and has
 * never quantified its own upstream latency, so polling faster than 10s spends
 * requests chasing freshness the vendor may not have.
 */
export const LIVE_POLL_INTERVAL_MS = 10_000

/**
 * Play-by-play cadence. Kept at the contract's 35s because this one multiplies
 * by the number of live games. See the note above.
 */
export const PBP_POLL_INTERVAL_MS = 35_000

/**
 * A gate that opens at most once per `intervalMs`.
 *
 * Lets one loop drive two different cadences: the loop ticks at the live
 * interval, and anything more expensive asks this whether it is due yet.
 *
 * ⚠ THE FIRST CALL ALWAYS OPENS. An invocation that polled scores but skipped
 * plays entirely would be worse than the single-tick cron this replaced — the
 * first pass of a fresh invocation is exactly when the play feed is most stale.
 */
export function createCadenceGate(
  intervalMs: number,
  now: () => number = () => Date.now(),
): () => boolean {
  let lastAt: number | null = null
  return () => {
    const t = now()
    if (lastAt !== null && t - lastAt < intervalMs) return false
    lastAt = t
    return true
  }
}

/**
 * How long one invocation may keep polling. Must stay comfortably under BOTH the
 * cron interval AND `maxDuration`, or invocations overlap.
 */
export const POLL_BUDGET_MS = 105_000

/**
 * Is any game actually being played right now?
 *
 * ⚠ READ FROM `SportsGame`, NOT FROM THE CLOCK. "It is Sunday afternoon" is not
 * the same claim as "a game is in progress" — kickoffs move, games run long, and
 * a bye week is still a Sunday. This asks the table the scores land in.
 *
 * Status strings differ per provider, so they go through the same
 * `normaliseStatus` the live adapter uses rather than being compared raw: one
 * source says "InProgress", another "Q3", another "halftime".
 */
export async function anyGameInProgress(now: Date = new Date()): Promise<boolean> {
  /*
   * A window rather than an exact status match, because a provider that has not
   * ticked a game to "in progress" yet would otherwise hide a live game. Three
   * hours back covers a game already running; thirty minutes forward catches one
   * about to start, which is when §4 wants a 60s poll anyway.
   */
  const from = new Date(now.getTime() - 3 * 3_600_000)
  const to = new Date(now.getTime() + 30 * 60_000)

  const rows = await prisma.sportsGame
    .findMany({
      where: { startTime: { gte: from, lte: to } },
      select: { status: true },
      take: 60,
    })
    .catch(() => [])

  return rows.some((r) => {
    const s = normaliseStatus(r.status ?? undefined)
    return s === 'in_progress' || s === 'scheduled'
  })
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export type PollLoopResult = {
  ticks: number
  stoppedBecause: 'budget' | 'no-active-games' | 'error'
  elapsedMs: number
}

/**
 * Run `tick` every 35s until the budget runs out or nothing is live.
 *
 * ⚠ ONE TICK ALWAYS RUNS, EVEN WITH NOTHING LIVE. The gate is checked AFTER the
 * first tick, not before it, so this is never less useful than the single-tick
 * cron it replaces. A missed final score at the end of a game is exactly what
 * skipping that tick would cause.
 *
 * ⚠ A FAILING TICK DOES NOT KILL THE LOOP. One bad poll — a provider blip, a
 * transient 500 — must not cost the remaining 70 seconds of coverage. The error
 * is returned to the caller for telemetry after the loop finishes.
 */
export async function runPollLoop(
  tick: () => Promise<void>,
  opts: {
    budgetMs?: number
    intervalMs?: number
    isActive?: () => Promise<boolean>
    now?: () => number
    sleepFn?: (ms: number) => Promise<void>
  } = {},
): Promise<PollLoopResult> {
  const budget = opts.budgetMs ?? POLL_BUDGET_MS
  const interval = opts.intervalMs ?? LIVE_POLL_INTERVAL_MS
  const isActive = opts.isActive ?? (() => anyGameInProgress())
  const clock = opts.now ?? (() => Date.now())
  const nap = opts.sleepFn ?? sleep

  const startedAt = clock()
  let ticks = 0
  let stoppedBecause: PollLoopResult['stoppedBecause'] = 'budget'

  for (;;) {
    try {
      await tick()
      ticks++
    } catch {
      // Swallowed on purpose — see the note above. The caller reports the run.
      ticks++
      stoppedBecause = 'error'
    }

    if (!(await isActive())) {
      stoppedBecause = ticks === 1 ? 'no-active-games' : stoppedBecause
      break
    }

    /*
     * Only sleep if the FULL next cycle fits. Sleeping into the budget and then
     * ticking past it is how an invocation overruns into the next one.
     */
    const elapsed = clock() - startedAt
    if (elapsed + interval + 5_000 >= budget) break

    await nap(interval)
  }

  return { ticks, stoppedBecause, elapsedMs: clock() - startedAt }
}
