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
 * How long the next call may take, given a deadline — or `null` when there is no time left.
 *
 * 🛑 THIS IS THE HALF `exhausted()` CANNOT DO, AND TWO CRONS HAVE DIED PROVING IT.
 * `exhausted()` is checked BETWEEN units, so with a second left it passes and the unit then runs
 * for as long as its own timeouts allow. Measured from the slow-tier dispatcher log 2026-09-06,
 * both against the 300s platform edge, and both already carrying a run budget:
 *
 *     /api/cron/import-schedules?riProfiles=1 ... FAIL HTTP 502 (300049ms)
 *     /api/cron/import-players ................. FAIL HTTP 502 (300037ms)
 *
 * The header above already says the budget bounds the NUMBER of units and not the duration of
 * one. This is what to reach for when a unit's duration is the thing that needs bounding: clamp
 * the call's own timeout to the time actually remaining, and the budget becomes a real ceiling.
 *
 * ⚠ RETURNS `null`, NOT `0`. A zero timeout is an instantly-aborted request that surfaces as a
 * provider failure — a different and more misleading claim than "we ran out of time". The 1s
 * floor means a call that cannot possibly finish is not started at all.
 *
 * ⚠ AND IT IS HERE RATHER THAN BESIDE ITS FIRST CALLER SO THERE IS ONE OF IT. A second copy in
 * another module is the duplicate-rule failure CLAUDE.md records for `normalizePlayerName` —
 * two implementations of one rule, free to drift.
 */
export function remainingFor(deadlineAt: number | undefined, cap: number): number | null {
  if (deadlineAt == null) return cap
  const left = deadlineAt - Date.now()
  if (left <= 1_000) return null
  return Math.min(cap, left)
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

/**
 * 270s against the 300s edge. A ceiling on the RESPONSE, not on the work.
 *
 * 🛑 WHY THE BUDGET ABOVE IS NOT ENOUGH, MEASURED 2026-09-07. Three different jobs 502'd in one
 * night at the edge, all within 150ms of each other:
 *
 *     import-schedules?sport=all   502 @ 300043ms
 *     import-stat-lines            502 @ 300147ms
 *     import-players               502 @ 300033ms
 *
 * All three ALREADY used `createRunBudget()` at 240s. The budget is checked BETWEEN units, so a
 * unit that starts at 239s runs as long as it likes — and these units call providers. Sixty
 * seconds of headroom does not bound a unit that takes minutes, which the header above states in
 * its own words: it bounds the NUMBER of units, not the duration of one.
 *
 * ⚠ THIS DOES NOT CANCEL THE WORK, AND CANNOT. There is no cancellation to reach for — the unit is
 * awaiting provider calls deep in modules that accept no signal. What changes is what the CALLER
 * gets. Today the edge severs at 300s and answers 502: the work is killed anyway, no row is
 * written, no partial result survives, and the freshness probe then reports CONFIG. With this, the
 * handler answers at 270s naming what it finished and what it deferred, the dispatcher records a
 * run, and the next fire continues from the rotation.
 *
 * So the trade is NOT "clean shutdown vs. orphaned work". It is "killed with nothing recorded" vs.
 * "killed with the partial result recorded". The work is equally dead either way.
 *
 * ⚠ REJECTIONS STILL PROPAGATE. If the work throws before the deadline the caller sees the throw
 * unchanged. This intercepts only the case where the work is still running.
 */
export const CRON_HARD_RESPONSE_MS = 270_000

export interface EdgeGuardResult<T> {
  result: T
  /** True when the deadline fired and `result` came from `onOverrun`, not from the work. */
  overran: boolean
}

/**
 * Race `work` against a hard deadline and return `onOverrun()` if it has not finished.
 *
 * @param work the handler's real work. Invoked immediately.
 * @param onOverrun builds the partial response. Must not throw and must not await.
 */
export async function respondBeforeEdge<T>(
  work: () => Promise<T>,
  onOverrun: () => T,
  hardMs: number = CRON_HARD_RESPONSE_MS,
): Promise<EdgeGuardResult<T>> {
  /*
   * 🛑 A SYMBOL, NOT null/undefined/a string. The sentinel is compared by identity against the
   * work's own resolved value, and handlers here legitimately resolve to undefined. Any sentinel a
   * caller could also produce would report a timeout that never happened — marking finished work
   * as deferred, which is the same class of lie as the 502 this replaces.
   */
  const TIMED_OUT = Symbol('cron.respondBeforeEdge.deadline')
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const raced = await Promise.race<T | typeof TIMED_OUT>([
      work(),
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), hardMs)
        /*
         * ⚠ `unref` so a pending deadline cannot by itself hold the process open. Optional-called
         * because the edge/browser timer type has no `unref`, and calling it blindly throws in the
         * runtimes where this matters least.
         */
        ;(timer as unknown as { unref?: () => void }).unref?.()
      }),
    ])
    return raced === TIMED_OUT ? { result: onOverrun(), overran: true } : { result: raced as T, overran: false }
  } finally {
    /*
     * ⚠ Always clear. On the fast path the timer is still pending, and leaving one behind per
     * invocation is a slow leak in a process that serves many cron fires.
     */
    if (timer) clearTimeout(timer)
  }
}
