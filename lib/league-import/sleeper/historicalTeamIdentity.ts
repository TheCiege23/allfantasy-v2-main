/**
 * Which CURRENT team a past Sleeper season's roster was — the id the historical matchup sync writes
 * into `MatchupFact.teamA` / `teamB` and `canonicalRosterIdByHistoricalRosterId`.
 *
 * A past roster maps through ITS OWNER to the slot that owner holds today
 * (`Roster.playerData.source_team_id`, which is `LeagueTeam.externalId`).
 *
 * 🛑 A MANAGER WHO HAS LEFT USED TO FALL BACK TO THEIR OLD `roster_id`. Sleeper hands a departed
 * manager's slot to whoever replaces them, so that number usually IS another person's team today:
 * every game the old manager played was credited to the new one. That fed career records, head-to-head,
 * rivalries, the per-game skill rating and the join gate built on it. A departed manager now gets a key
 * of their own (`former:sleeper:<ownerId>`) that no current team holds, so their games stay theirs.
 *
 * 🛑 AND THE OWNER LOOKUP WAS KEYED ON `Roster.platformUserId`, which is the AllFantasy user id once a
 * team is claimed (see `importedRosterIdentity.ts`). A claimed manager's Sleeper `owner_id` therefore
 * missed, fell back to the old slot, and could land on someone else in exactly the same way. The
 * import's own `source_manager_id` is read first now.
 */

export const FORMER_SLEEPER_KEY_PREFIX = 'former:sleeper:'

/**
 * Bumped when the mapping changes meaning. A stored season below it is checked once more by the sync
 * (see `SleeperHistoricalMatchupSyncService`), because the completion gate never re-reads settled history.
 */
export const SLEEPER_TEAM_IDENTITY_VERSION = 2

/** A manager who played that season and holds no team in the league now. */
export function formerSleeperManagerKey(ownerId: string): string {
  return `${FORMER_SLEEPER_KEY_PREFIX}${ownerId}`
}

/** A past roster with no owner at all — one key per season and slot, never shared with a person. */
export function formerSleeperSlotKey(season: number, rosterId: string): string {
  return `${FORMER_SLEEPER_KEY_PREFIX}slot:${season}:${rosterId}`
}

export type FormerSleeperKey =
  | { kind: 'manager'; ownerId: string }
  | { kind: 'slot'; season: number; rosterId: string }

export function parseFormerSleeperKey(key: string | null | undefined): FormerSleeperKey | null {
  const s = String(key ?? '')
  if (!s.startsWith(FORMER_SLEEPER_KEY_PREFIX)) return null
  const rest = s.slice(FORMER_SLEEPER_KEY_PREFIX.length)
  const slot = /^slot:(\d+):(.+)$/.exec(rest)
  if (slot) return { kind: 'slot', season: Number(slot[1]), rosterId: slot[2] }
  return rest ? { kind: 'manager', ownerId: rest } : null
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

function blob(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * Sleeper user id → the slot that manager holds today.
 *
 * Read in order of how certain each source is that it names the SLEEPER user:
 *   1. `Roster.playerData.source_manager_id` (or `import.sourceManagerId`) — written by the import, always the provider id;
 *   2. `LeagueTeam.platformUserId` beside `externalId`;
 *   3. `Roster.platformUserId` — the provider id only while the team is unclaimed.
 * A source never overrides one before it, so a stale or AllFantasy-keyed value cannot move a manager.
 */
export function currentSlotBySleeperOwner(args: {
  rosters: ReadonlyArray<{ platformUserId: string | null; playerData: unknown }>
  teams?: ReadonlyArray<{ externalId: string | null; platformUserId: string | null }>
}): Map<string, string> {
  const out = new Map<string, string>()
  const put = (owner: string | null, slot: string | null) => {
    if (owner && slot && !out.has(owner)) out.set(owner, slot)
  }
  const rosterSlots = args.rosters.map((r) => {
    const b = blob(r.playerData)
    const slot = str(b?.source_team_id) ?? str(blob(b?.import)?.sourceTeamId)
    const manager = str(b?.source_manager_id) ?? str(blob(b?.import)?.sourceManagerId)
    return { slot, manager, key: str(r.platformUserId) }
  })
  for (const r of rosterSlots) put(r.manager, r.slot)
  for (const t of args.teams ?? []) put(str(t.platformUserId), str(t.externalId))
  for (const r of rosterSlots) put(r.key, r.slot)
  return out
}

/**
 * That season's `roster_id` → the id its games are stored under.
 *
 * The owner first, then a co-owner, to the slot they hold today; otherwise the departed owner's own
 * key; otherwise (no owner at all) a key for that season's slot. Never the bare `roster_id` — except
 * in the CURRENT season, where `roster_id` is the team (`LeagueTeam.externalId`), owned or not.
 */
export function canonicalIdsForSeason(args: {
  season: number
  rosters: ReadonlyArray<{ roster_id: unknown; owner_id?: unknown; co_owners?: unknown }>
  currentSlotByOwner: ReadonlyMap<string, string>
  isCurrentSeason?: boolean
}): Map<string, string> {
  const out = new Map<string, string>()
  for (const roster of args.rosters) {
    const rosterId = str(roster?.roster_id)
    if (!rosterId) continue
    if (args.isCurrentSeason) {
      out.set(rosterId, rosterId)
      continue
    }
    const owner = str(roster.owner_id)
    const coOwners = Array.isArray(roster.co_owners) ? roster.co_owners.map(str).filter((x): x is string => !!x) : []
    const current = [owner, ...coOwners].map((o) => (o ? args.currentSlotByOwner.get(o) : undefined)).find(Boolean)
    out.set(rosterId, current ?? (owner ? formerSleeperManagerKey(owner) : formerSleeperSlotKey(args.season, rosterId)))
  }
  return out
}

/** Same historical → canonical mapping, entry for entry. Order-insensitive; values compared as strings. */
export function sameCanonicalMap(stored: unknown, next: ReadonlyMap<string, string>): boolean {
  const s = blob(stored)
  if (!s) return false
  const keys = Object.keys(s)
  if (keys.length !== next.size) return false
  return keys.every((k) => next.has(k) && String(s[k]) === next.get(k))
}
