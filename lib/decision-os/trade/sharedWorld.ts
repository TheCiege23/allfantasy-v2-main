import type { CanonicalWorld } from '@/lib/decision-os/world/facts'

/**
 * One canonical world for a batch of trade evaluations in one league, loaded once (2026-11-20).
 *
 * Chimmy's pending-trade inbox grades up to three offers one after another, and `evaluateStoredTrade`
 * re-resolved the same league's world (league, teams, rosters, performances) for every one of them. The
 * batch now loads it once and hands EACH evaluation its own `structuredClone`, so:
 *
 *   - the grades are the ones each evaluation would have produced: same league, same request, same rows;
 *   - no evaluation can change another's input, whatever a helper downstream does with the object;
 *   - a miss (null, or a throw read as null) is never shared — the next evaluation loads again, exactly
 *     as it did before this existed.
 *
 * 🛑 PER BATCH, NEVER LONGER. This is deliberately not a cache. `checkRosters` tests each offered player
 * against `world.rosters`; a world kept past the request would pass a player who has since been traded
 * away, and the grade would describe a deal that can no longer be made. That is also why the inbox does
 * not read the world through the domain-OS store (its Dates would not survive JSON either).
 */
export function oneWorldPerBatch(
  load: (leagueId: string) => Promise<CanonicalWorld | null>,
): (leagueId: string) => Promise<CanonicalWorld | null> {
  const held = new Map<string, Promise<CanonicalWorld | null>>()
  return async (leagueId) => {
    let pending = held.get(leagueId)
    if (!pending) {
      pending = load(leagueId).catch(() => null)
      held.set(leagueId, pending)
    }
    const world = await pending
    if (!world) {
      held.delete(leagueId)
      return null
    }
    return structuredClone(world)
  }
}
