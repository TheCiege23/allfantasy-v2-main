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
    const { pd, imp } = importBlock(r)
    const ids = new Set([str(r.platformUserId), str(pd?.source_manager_id), str(imp?.sourceManagerId)])
    for (const id of ids) add(id, r.id)
  }
  return map
}

function importBlock(r: MirrorRosterRow): { pd: Record<string, unknown> | null; imp: Record<string, unknown> | null } {
  const pd = r.playerData && typeof r.playerData === 'object' ? (r.playerData as Record<string, unknown>) : null
  const imp = pd?.import && typeof pd.import === 'object' ? (pd.import as Record<string, unknown>) : null
  return { pd, imp }
}

/** The manager name the import recorded for a roster, if any. */
export function rosterImportedName(r: MirrorRosterRow): string | null {
  const { imp } = importBlock(r)
  return str(imp?.displayName) ?? str(imp?.ownerName) ?? str(imp?.teamName)
}

/**
 * Sleeper's own roster number (`roster_id`, 1..N) -> `Roster.id`. This is what Sleeper's
 * `slot_to_roster_id` speaks, so it seats a mirrored draft exactly, before any pick exists.
 * A number claimed by two rosters maps to neither.
 */
export function buildSleeperTeamNumberToRosterIdMap(rosters: MirrorRosterRow[]): Map<string, string> {
  const map = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const r of rosters) {
    const { pd, imp } = importBlock(r)
    const n = str(imp?.sourceTeamId) ?? str(pd?.source_team_id)
    if (!n || ambiguous.has(n)) continue
    const existing = map.get(n)
    if (existing && existing !== r.id) {
      map.delete(n)
      ambiguous.add(n)
      continue
    }
    map.set(n, r.id)
  }
  return map
}

export type MirrorSlotOrderEntry = { slot: number; rosterId: string; displayName: string }

/**
 * True when a saved draft order seats a roster this league no longer has.
 *
 * A re-import deletes and recreates every roster, so an order saved before it keeps pointing at
 * ids that are gone: the board shows a header per column, but no name, no avatar, and nothing
 * matches "my team". The shape checks pass (16 slots, 16 non-empty ids), which is why nothing
 * repaired it. `placeholder-N` seats are deliberate and never count. An empty roster set cannot
 * judge anything and answers false.
 */
export function slotOrderHasMissingRosters(order: unknown, rosterIds: Set<string>): boolean {
  if (!Array.isArray(order) || rosterIds.size === 0) return false
  return order.some((raw) => {
    const rid = raw && typeof raw === 'object' ? (raw as { rosterId?: unknown }).rosterId : null
    return typeof rid === 'string' && rid.length > 0 && !rid.startsWith('placeholder-') && !rosterIds.has(rid)
  })
}

/**
 * Rebuild a mirrored draft's seat order from its own picks, with no provider call.
 *
 * Each mirrored pick carries the column it sits in (`slot`, Sleeper's `draft_slot`) and the Sleeper
 * user who made it. A slot goes to the roster that made a strict majority of that column's picks, so
 * a traded pick or two cannot move a seat. Returns null unless EVERY slot resolves to a distinct
 * roster: a partial order would put two columns under one name, which is worse than the stale one.
 */
export function slotOrderFromMirroredPicks(input: {
  teamCount: number
  picks: Array<{ slot: number; rosterId: string; source?: string | null; displayName?: string | null }>
  sleeperUserToRosterId: Map<string, string>
  nameForRoster: (rosterId: string) => string | null
}): MirrorSlotOrderEntry[] | null {
  const { teamCount } = input
  if (!Number.isInteger(teamCount) || teamCount < 1) return null
  const votes = new Map<number, Map<string, number>>()
  const pickName = new Map<string, string>()
  for (const p of input.picks) {
    if (p.source !== 'sleeper-mirror') continue
    if (!Number.isInteger(p.slot) || p.slot < 1 || p.slot > teamCount) continue
    const rosterId = input.sleeperUserToRosterId.get(p.rosterId)
    if (!rosterId) continue
    const forSlot = votes.get(p.slot) ?? new Map<string, number>()
    forSlot.set(rosterId, (forSlot.get(rosterId) ?? 0) + 1)
    votes.set(p.slot, forSlot)
    const n = str(p.displayName)
    if (n && !pickName.has(rosterId)) pickName.set(rosterId, n)
  }
  const out: MirrorSlotOrderEntry[] = []
  const used = new Set<string>()
  for (let slot = 1; slot <= teamCount; slot++) {
    const forSlot = votes.get(slot)
    if (!forSlot) return null
    let total = 0
    let best: [string, number] | null = null
    for (const [rid, n] of forSlot) {
      total += n
      if (!best || n > best[1]) best = [rid, n]
    }
    if (!best || best[1] * 2 <= total || used.has(best[0])) return null
    used.add(best[0])
    out.push({ slot, rosterId: best[0], displayName: input.nameForRoster(best[0]) ?? pickName.get(best[0]) ?? '' })
  }
  return out
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
