/**
 * Which leagues the historical-refresh rotation should touch this fire.
 *
 * ── ⚠ STALENESS ALONE STARVES THE LEAGUES PEOPLE ACTUALLY USE ────────────────────────────────
 *
 * The rotation began as pure oldest-refreshed-first. That is fair and it is the wrong kind of
 * fair: a league nobody has opened since June sits at the front of the queue ahead of the one
 * its owner is looking at right now, because "fair" was measured in the only unit available.
 *
 * ── AND DEMAND ALONE STARVES EVERYTHING ELSE ────────────────────────────────────────────────
 *
 * Ordering purely by `lastViewedAt` would refresh the same handful of active leagues forever and
 * never reach the tail — and the tail drifting is invisible by definition, because nobody is
 * looking at it. That is worse than the problem it fixes, since it would look healthy from every
 * angle someone might check.
 *
 * So: two buckets and a reserve. Starved leagues get a guaranteed floor of the slots, in-demand
 * leagues get the rest, and whichever bucket runs short donates its unused slots to the other.
 * Neither can lock the other out.
 *
 * ── 🛑 THE ORDERING IS WORTHLESS WITHOUT ITS SIGNAL, AND THE SIGNAL IS NEW ───────────────────
 *
 * `League.lastViewedAt` was measured as absent before this was written: `activity_events` had 0
 * rows for all 199 rotation leagues and `decision_intelligence_runs` had 0 rows with a league at
 * all. Sorting on either would have produced arbitrary order wearing a principled name.
 *
 * Which is why `demandLeagueIds` being EMPTY is a first-class case here rather than an edge one:
 * before anybody opens a league, every slot goes to the starved bucket and this degrades exactly
 * to the staleness rotation it replaced. That is the correct behaviour, not a fallback.
 */

/**
 * Slots reserved for the starved bucket before demand gets any.
 *
 * ⚠ A RESERVE, NOT A CAP. Unused starved slots flow to demand and vice versa, so this sets the
 * floor on tail progress rather than a ceiling on either bucket. Set to a clear majority: the
 * backlog is the current problem (the oldest row in production had not been refreshed since
 * June), and demand ordering is worth much less while the tail is months behind.
 */
export const STARVED_RESERVE = 15

export type RotationSelection = {
  leagueIds: string[]
  fromStarved: number
  fromDemand: number
}

/**
 * Merge the two buckets. Pure — every branch is testable with no database and no provider.
 *
 * @param starvedLeagueIds oldest-refreshed first
 * @param demandLeagueIds  most-recently-viewed first
 */
export function mergeRotation(args: {
  starvedLeagueIds: readonly string[]
  demandLeagueIds: readonly string[]
  cap: number
  starvedReserve?: number
}): RotationSelection {
  const cap = Math.max(0, args.cap)
  const reserve = Math.min(cap, Math.max(0, args.starvedReserve ?? STARVED_RESERVE))

  const chosen: string[] = []
  const seen = new Set<string>()
  let fromStarved = 0
  let fromDemand = 0

  const push = (id: string, bucket: 'starved' | 'demand'): boolean => {
    if (chosen.length >= cap) return false
    /*
     * ⚠ DEDUPE ACROSS BUCKETS. A league can be BOTH starved and in demand — someone opened it
     * yesterday and it still has not been refreshed. That is the highest-priority league there
     * is, and without this it would consume two of the fire's slots to be refreshed once.
     */
    if (seen.has(id)) return false
    seen.add(id)
    chosen.push(id)
    if (bucket === 'starved') fromStarved += 1
    else fromDemand += 1
    return true
  }

  // 1. The reserved floor for the tail.
  for (const id of args.starvedLeagueIds) {
    if (chosen.length >= reserve) break
    push(id, 'starved')
  }

  // 2. Demand fills the remainder.
  for (const id of args.demandLeagueIds) {
    if (chosen.length >= cap) break
    push(id, 'demand')
  }

  // 3. Whatever demand did not use goes back to the tail, so a fire is never left short
  //    simply because few leagues have been opened yet.
  for (const id of args.starvedLeagueIds) {
    if (chosen.length >= cap) break
    push(id, 'starved')
  }

  return { leagueIds: chosen, fromStarved, fromDemand }
}
