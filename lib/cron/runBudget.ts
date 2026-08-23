/**
 * Wall-clock budget for cron handlers that iterate a work list.
 *
 * ⚠ THE CEILING IS NOT OURS. Measured 2026-08-23: `import-players` and `import-season-stats` both
 * returned **HTTP 502 at ~300,200ms** — the platform edge severs the connection at a 300s cap and
 * answers 502 itself. `export const maxDuration = 300` on these routes is the same number, so
 * there is no configuration on our side that buys more time in one request.
 *
 * This was originally misdiagnosed. The dispatcher's client timeout was also 300s, so the failure
 * looked like our own race; raising the dispatcher to 600s only moved past OUR limit and revealed
 * the real one. Raising timeouts cannot fix this — the work has to fit.
 *
 * WHAT THIS BUYS. A handler that processes units (sports, weeks, teams) stops before the ceiling,
 * reports what it did NOT get to, and the next scheduled fire continues. Progress per run instead
 * of a 502 and nothing. `import-player-game-stats` already worked this way with a per-week ledger;
 * this generalises the same idea so three more jobs can use it.
 *
 * ⚠ IT BOUNDS THE NUMBER OF UNITS, NOT THE DURATION OF ONE. If a single unit takes longer than the
 * ceiling on its own, this cannot help and that unit needs splitting further. The budget is checked
 * BETWEEN units, never during one.
 *
 * PAIR IT WITH STALENESS ORDERING. A budget alone makes a handler that always starts at the same
 * unit do the first few forever and never reach the rest. Order the work list by how stale each
 * unit is, oldest first, and successive runs cover everything without needing a stored cursor.
 */

/**
 * 240s against a 300s ceiling.
 *
 * The 60s of headroom is not padding: the budget is only checked BETWEEN units, so a unit started
 * at 239s runs to completion past the check, and the response still has to serialise and return
 * before the edge gives up.
 */
export const CRON_RUN_BUDGET_MS = 240_000

export interface RunBudget {
  /** True once the budget is spent. Check BETWEEN units, before starting the next one. */
  exhausted(): boolean
  elapsedMs(): number
  /** Milliseconds left, floored at 0 — useful for logging why a run stopped early. */
  remainingMs(): number
}

export function createRunBudget(budgetMs: number = CRON_RUN_BUDGET_MS, now: () => number = Date.now): RunBudget {
  const startedAt = now()
  return {
    exhausted: () => now() - startedAt >= budgetMs,
    elapsedMs: () => now() - startedAt,
    remainingMs: () => Math.max(0, budgetMs - (now() - startedAt)),
  }
}

/**
 * Rotate a work list so a different unit leads each period.
 *
 * ⚠ A BUDGET WITHOUT THIS STARVES THE TAIL. A handler that always iterates the same fixed order
 * and stops when time runs out does the first few units forever and never reaches the rest — the
 * budget converts "everything is late" into "the tail is never done", which is worse because it
 * looks fine.
 *
 * That is not hypothetical here. `sports-data-importer` has had a per-sport budget over a fixed
 * `SUPPORTED_SPORTS` order, and its own comment records the result: NBA, NHL, MLB and SOCCER sat
 * frozen at 2026-04-26 in production while NFL — first in the list — kept getting updated.
 *
 * Rotation rather than staleness ordering on purpose: it needs no timestamp query, so it cannot
 * itself fail or add latency to a handler that is already out of time, and it gives every unit the
 * lead position within one full cycle regardless of what the data looks like.
 *
 * @param periodMs how long each unit holds the lead. Default one day; pass the cron's own interval
 *   when it runs more often than daily, or the same unit leads every fire.
 */
export function rotateForFairness<T>(
  units: readonly T[],
  periodMs: number = 24 * 60 * 60 * 1000,
  now: () => number = Date.now,
): T[] {
  if (units.length <= 1) return [...units]
  const offset = Math.floor(now() / periodMs) % units.length
  return [...units.slice(offset), ...units.slice(0, offset)]
}
