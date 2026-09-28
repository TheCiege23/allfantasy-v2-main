/**
 * Which seasons one score-sync tick reconciles.
 *
 * 🛑 It took `take: 50` with no order: past 50 active native seasons, whichever rows Postgres
 * returned first were scored every five minutes and the rest were never scored at all — no
 * error, just leagues whose weeks never closed. This takes a window that moves each tick over a
 * stable order, so every season is reached within ceil(count / batch) ticks.
 */
export const SCORE_SYNC_BATCH = 50
export const SCORE_SYNC_TICK_MS = 5 * 60 * 1000

export function rotatingBatch<T>(items: readonly T[], batchSize: number, now: number, tickMs = SCORE_SYNC_TICK_MS): T[] {
  if (items.length <= batchSize) return [...items]
  const windows = Math.ceil(items.length / batchSize)
  const start = (Math.floor(now / tickMs) % windows) * batchSize
  return items.slice(start, start + batchSize)
}
