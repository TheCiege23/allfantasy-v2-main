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
  /**
   * How many slots a unit gets in the rotation basis. Default 1 for anything unlisted.
   *
   * 🛑 WHY A UNIT MIGHT NEED MORE THAN ONE, MEASURED RATHER THAN GUESSED. Plain rotation gives
   * every unit the lead once per `units.length` periods, which is fair by COUNT and unfair by
   * COST. A unit big enough that it only ever finishes when it leads is therefore refreshed once
   * per full cycle, however often the job runs.
   *
   * Observed on 2026-09-03 in `AFProjectionSnapshot`: NCAAF held 10,189 rows against NFL's 3,154,
   * and every NCAAF row dated from 2026-08-31 — its previous turn at the front, exactly 7 days
   * back in a 7-sport rotation. Every other sport had written within the last two days. Nothing
   * was broken; the biggest sport was simply on the worst cadence, and its rows were old enough
   * to predate the rest-of-season columns entirely, so college priced at nothing.
   *
   * ⚠ THIS IS NOT STALENESS ORDERING, DELIBERATELY. The header above rejects that: it needs a
   * timestamp query, which can fail or add latency inside a handler that is already out of time.
   * A static weight is decided before the run starts and cannot fail.
   */
  leadShare?: ReadonlyMap<T, number>,
): T[] {
  if (units.length <= 1) return [...units]

  /*
   * The basis repeats a unit `share` times, so rotation lands on it that many times per cycle.
   * A share of 2 in a 7-unit list makes an 8-slot basis: that unit leads twice per 8 periods
   * (~every 4) instead of once per 7, and its AVERAGE position improves on the other days too.
   */
  const basis: T[] = []
  for (const u of units) {
    /*
     * 🛑 A NON-FINITE SHARE MUST BECOME 1, NOT PROPAGATE. `Math.max(1, Math.floor(NaN))` is NaN,
     * `for (i = 0; i < NaN; …)` never iterates, and the unit is DROPPED FROM THE ROTATION
     * ENTIRELY — never computed at all, which is far worse than the slow refresh this weighting
     * exists to fix. Caught by a test passing NaN; the first version had exactly this hole.
     */
    const raw = leadShare?.get(u)
    const share = Number.isFinite(raw) ? Math.max(1, Math.floor(raw as number)) : 1
    for (let i = 0; i < share; i += 1) basis.push(u)
  }

  /*
   * ⚠ MODULO `basis.length`, NOT `units.length`. With any weight above 1 the cycle is longer than
   * the unit count, and using the shorter modulus would visit only a prefix of the basis — the
   * weighted unit would gain nothing on the days its extra slots fall outside the window.
   * `basis.length >= units.length >= 2` here, so there is no zero divisor.
   */
  const offset = Math.floor(now() / periodMs) % basis.length
  const rotated = [...basis.slice(offset), ...basis.slice(0, offset)]

  /*
   * ⚠ DEDUPE KEEPING THE FIRST OCCURRENCE, OR A WEIGHTED UNIT IS PROCESSED TWICE IN ONE RUN —
   * which would spend the budget on work already done and starve the tail this function exists to
   * protect. Every unit appears exactly once in the output, and the output length always equals
   * `units.length`, weighted or not.
   */
  const seen = new Set<T>()
  const out: T[] = []
  for (const u of rotated) {
    if (seen.has(u)) continue
    seen.add(u)
    out.push(u)
  }
  return out
}
