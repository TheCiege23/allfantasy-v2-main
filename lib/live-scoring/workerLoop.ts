/**
 * Live Scoring — external worker loop controller (G11 Phase 3c).
 *
 * Vercel cron's floor is 1 minute, but live scoring needs true 30s polling during
 * games. This is the PURE control logic for a long-running worker that ticks the
 * SAME `runLiveScoringForActiveSeasons` (no second scoring impl) and sleeps on the
 * cadence the engine returns. All effects (tick, sleep, stop) are injected so it is
 * fully unit-testable; `scripts/live-score-worker.ts` wires the real ones.
 */

export type WorkerSleepOptions = {
  /** Floor so a misconfigured 0/short cadence can't hot-loop. */
  minMs: number
  /** Ceiling so we never sleep absurdly long. */
  maxMs: number
  /** Idle re-check interval when nothing is active (cadence 0) — the worker is a
   *  daemon, so it keeps checking for newly-started games rather than stopping. */
  idleMs: number
}

export const DEFAULT_WORKER_SLEEP: WorkerSleepOptions = {
  minMs: 15_000,
  maxMs: 300_000,
  idleMs: 60_000,
}

/**
 * Resolve how long to sleep before the next tick. Pure.
 * - cadence `<= 0` (nothing active) → `idleMs` (keep checking for new games).
 * - otherwise clamp the engine cadence to `[minMs, maxMs]` (30s live stays 30s).
 */
export function resolveWorkerSleepMs(nextPollDelayMs: number, opts: WorkerSleepOptions = DEFAULT_WORKER_SLEEP): number {
  if (!Number.isFinite(nextPollDelayMs) || nextPollDelayMs <= 0) return opts.idleMs
  return Math.max(opts.minMs, Math.min(opts.maxMs, nextPollDelayMs))
}

/**
 * Single-flight guard so a slow tick can never overlap with the next one. Returns
 * `{ skipped: true }` if a run is already in progress.
 */
export function createOverlapGuard() {
  let running = false
  return {
    isRunning: () => running,
    async run<T>(fn: () => Promise<T>): Promise<{ skipped: true } | { skipped: false; result: T }> {
      if (running) return { skipped: true }
      running = true
      try {
        const result = await fn()
        return { skipped: false, result }
      } finally {
        running = false
      }
    },
  }
}

export type WorkerTickResult = { nextPollDelayMs: number; polled: number; ticked: number }

export type WorkerLoopDeps = {
  /** One tick — wraps `runLiveScoringForActiveSeasons`. */
  tick: () => Promise<WorkerTickResult>
  /** Sleep for ms (injected so tests don't actually wait). */
  sleep: (ms: number) => Promise<void>
  /** Return true to stop the loop (signal handler / max-iterations). */
  shouldStop: () => boolean
  sleepOptions?: WorkerSleepOptions
  onTick?: (result: WorkerTickResult, sleptMs: number) => void
}

/**
 * Run the worker loop until `shouldStop()` is true. Sequential (await tick → await
 * sleep) so ticks never overlap; an extra overlap guard protects against any
 * out-of-band invocation. Returns the number of completed ticks.
 */
export async function runWorkerLoop(deps: WorkerLoopDeps): Promise<{ ticks: number }> {
  const opts = deps.sleepOptions ?? DEFAULT_WORKER_SLEEP
  const guard = createOverlapGuard()
  let ticks = 0

  while (!deps.shouldStop()) {
    const outcome = await guard.run(deps.tick)
    if (outcome.skipped) {
      await deps.sleep(opts.minMs)
      continue
    }
    ticks += 1
    const sleptMs = resolveWorkerSleepMs(outcome.result.nextPollDelayMs, opts)
    deps.onTick?.(outcome.result, sleptMs)
    if (deps.shouldStop()) break
    await deps.sleep(sleptMs)
  }

  return { ticks }
}
