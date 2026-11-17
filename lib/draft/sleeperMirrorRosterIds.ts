/**
 * Translate the Sleeper USER id a mirrored pick carries into this league's roster id.
 *
 * `lib/draft/sleeperSync.ts` writes `picked_by` (a Sleeper user id) into `DraftPick.rosterId`
 * and says so in its own comment. Every room surface compares `pick.rosterId` against
 * `currentUserRosterId`, which is `Roster.id`, so in a mirrored draft "my picks" matched
 * nothing — the roster tab was empty for every manager, with the board looking full.
 *
 * The Sleeper user id lives in one of three places on a roster, and the first is NOT enough:
 *   - `platformUserId` — the Sleeper id for an unclaimed import, but claiming a team
 *     overwrites it with the AllFantasy user id. So the managers actually using
 *     AllFantasy are precisely the ones a `platformUserId`-only lookup misses.
 *   - `playerData.source_manager_id`
 *   - `playerData.import.sourceManagerId`
 *
 * Read-time only: the stored rows keep the Sleeper id, because other readers of
 * `DraftPick.rosterId` (ADP aggregation among them) already depend on that id space.
 */

export type MirrorRosterRow = {
  id: string
  platformUserId: string | null
  playerData: unknown
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim().length > 0) return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

/** Sleeper user id -> `Roster.id`. A Sleeper id claimed by two rosters maps to neither. */
export function buildSleeperUserToRosterIdMap(rosters: MirrorRosterRow[]): Map<string, string> {
  const map = new Map<string, string>()
  const ambiguous = new Set<string>()
  const add = (sleeperUserId: string | null, rosterId: string) => {
    if (!sleeperUserId || ambiguous.has(sleeperUserId)) return
    const existing = map.get(sleeperUserId)
    if (existing && existing !== rosterId) {
      map.delete(sleeperUserId)
      ambiguous.add(sleeperUserId)
      return
    }
    map.set(sleeperUserId, rosterId)
  }
  for (const r of rosters) {
    const pd = r.playerData && typeof r.playerData === 'object' ? (r.playerData as Record<string, unknown>) : null
    const imp = pd?.import && typeof pd.import === 'object' ? (pd.import as Record<string, unknown>) : null
    const ids = new Set([str(r.platformUserId), str(pd?.source_manager_id), str(imp?.sourceManagerId)])
    for (const id of ids) add(id, r.id)
  }
  return map
}

/** Rewrite `rosterId` on mirrored picks only; anything unmapped keeps its stored value. */
export function remapSleeperMirrorPickRosterIds<T extends { rosterId: string; source?: string | null }>(
  picks: T[],
  sleeperUserToRosterId: Map<string, string>,
): T[] {
  if (sleeperUserToRosterId.size === 0) return picks
  return picks.map((p) => {
    if (p.source !== 'sleeper-mirror') return p
    const mapped = sleeperUserToRosterId.get(p.rosterId)
    return mapped && mapped !== p.rosterId ? { ...p, rosterId: mapped } : p
  })
}
