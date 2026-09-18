/**
 * Hold the slate still while someone is reading it.
 *
 * ⚠ THE SERVER'S ORDER IS VOLATILE BY CONSTRUCTION, AND NOT BECAUSE OF SCORES.
 * `getLivePageData` sorts by leagues affected and breaks ties on CLOSENESS —
 * `Math.abs(winProbability.home - 50)` — and `estimateWinProbability` reads
 * `fractionRemaining(period, clock)`. The clock advances between every poll, so
 * two evenly matched games can swap places every twenty seconds while nobody
 * scores. The card you are reading moves, for a reason you cannot perceive.
 *
 * That sort is right for deciding what the slate looks like when you ARRIVE. It is
 * wrong as a thing to re-apply underneath you.
 */

/**
 * Re-apply a previous order to a fresh list.
 *
 * Items already placed keep their positions; anything new goes to the end in the
 * server's own order; anything gone simply drops out.
 *
 * ⚠ THE COST IS THAT THE ORDER GOES STALE, AND THAT IS THE DELIBERATE TRADE. A
 * game that becomes the closest on the board will not climb while you watch. The
 * alternative is a list that re-sorts under the reader on a timer, which is worse:
 * a ranking nobody asked to see change is not worth a tap landing on the wrong
 * card. The caller drops the remembered order when the VIEW changes — a new sport
 * or scope is a new question, and deserves a fresh answer.
 */
export function applyStableOrder<T>(
  previousOrder: readonly string[] | null,
  next: readonly T[],
  keyOf: (item: T) => string,
): T[] {
  if (previousOrder == null || previousOrder.length === 0) return [...next]

  const rank = new Map(previousOrder.map((key, index) => [key, index]))
  const placed: T[] = []
  const appended: T[] = []

  for (const item of next) {
    if (rank.has(keyOf(item))) placed.push(item)
    else appended.push(item)
  }

  /*
   * Sorted by the remembered rank rather than filtered out of `previousOrder`, so
   * a key appearing twice cannot drop a row, and the comparison never consults
   * anything that moves.
   */
  placed.sort((a, b) => rank.get(keyOf(a))! - rank.get(keyOf(b))!)

  return [...placed, ...appended]
}

/** The order to remember for next time. */
export function orderOf<T>(items: readonly T[], keyOf: (item: T) => string): string[] {
  return items.map(keyOf)
}
