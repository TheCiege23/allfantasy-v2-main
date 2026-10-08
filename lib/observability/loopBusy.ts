/**
 * How busy the server's JavaScript thread was over a window — `af.loop.busy_pct` (2026-10-07).
 *
 * Measured 2026-10-07: every query the /core home issues runs in well under a millisecond in
 * Postgres (pg_stat_statements: the SportsDataCache lookup averages 0.20 ms over 1.25M calls; the
 * home's LeagueTrade read runs in 40 ms cold under EXPLAIN ANALYZE), yet the app sees ~30-40 ms per
 * query on average and up to 2 s on the slow ones. Railway shows the service peaking at 0.94-1.08
 * CPU — one core, which is all a single Node process can run JavaScript on. The working explanation
 * is that a busy thread, not the database, is what each query result waits behind. This measures it
 * directly instead of inferring it.
 *
 * Event-loop utilization over a window is the fraction of that window the thread spent running code
 * rather than idling for I/O. A card that waited nine seconds at ~100% waited on CPU — its own or
 * another request's; one that waited at ~10% waited on something outside the process.
 *
 * ⚠ IT MEASURES THE WHOLE PROCESS, NOT THE CARD. Concurrent requests share the thread, so a high
 * reading says the card waited behind CPU work; it does not say the card did that work.
 *
 * ⚠ NEVER THROWS, AND IS NULL WHERE THE API DOES NOT EXIST. `performance.eventLoopUtilization` is
 * Node-only; a browser or jsdom has `performance` without it. Read through `globalThis` rather than
 * importing `node:perf_hooks`, so nothing here can pull a Node built-in into a client bundle.
 */

type Elu = { idle: number; active: number; utilization: number }
/** Node's signature: no argument is the running total; one argument is the delta from it to now. */
type EluFn = (since?: Elu) => Elu

export type LoopMark = Elu | null

function elu(): EluFn | null {
  const perf = (globalThis as { performance?: { eventLoopUtilization?: EluFn } }).performance
  return typeof perf?.eventLoopUtilization === 'function' ? perf.eventLoopUtilization.bind(perf) : null
}

/** A snapshot to measure from. Null where the runtime cannot measure. */
export function markLoop(): LoopMark {
  try {
    return elu()?.() ?? null
  } catch {
    return null
  }
}

/** Percent of the time since `mark` the thread was busy, 0-100. Null when either end cannot be read. */
export function loopBusyPctSince(mark: LoopMark): number | null {
  if (!mark) return null
  try {
    const fn = elu()
    if (!fn) return null
    const pct = fn(mark).utilization * 100
    return Number.isFinite(pct) ? Math.min(100, Math.max(0, Math.round(pct))) : null
  } catch {
    return null
  }
}
