/**
 * Which stored `Roster` row an imported team writes to, and the owner key it is stored under.
 *
 * `rosters` is unique on `(leagueId, platformUserId)`. The import bootstrap used to find a team's
 * row by that owner key alone, and that went wrong in two ways:
 *
 * 🛑 EVERY ORPHAN TEAM IN A LEAGUE SHARED ONE ROW. An orphan has no manager, so its key was `''`,
 * and each orphan's write overwrote the previous one: only the last orphan in a league kept a
 * roster. Measured on staging 2026-09-17: 50 of 69 orphan teams in 8 Sleeper leagues had no roster
 * row at all ("TPG Chopped": 26 orphan teams, 1 roster).
 *
 * 🛑 AN OWNER CHANGE MADE A SECOND ROW. A team whose manager changed (or left, or arrived) matched no
 * row under its new key, so a new row was created and the old one stayed behind with the same team.
 * Measured in production 2026-09-17 (read-only): 33 such rows in 29 of 290 Sleeper/MFL leagues, still
 * being created by the four-hourly Sleeper sync, which runs this bootstrap.
 *
 * So a team is matched by its provider team id first (`playerData.source_team_id`, which every
 * import writes), an orphan gets a key of its own (`orphan-<provider>-<teamId>`, the repo's orphan
 * convention: see `lib/orphan-ai-manager/orphan-platform-ids.ts`), and an owner change moves the
 * existing row to the new key instead of adding one. Rows already duplicated are left alone: removing
 * them is a data decision.
 */

export type StoredRosterRow = { id: string; platformUserId: string; playerData: unknown }

export type IncomingTeam = {
  /** Provider team id (`source_team_id`). */
  teamId: string
  /** The key this team's row should carry: the resolved owner, or the orphan key. */
  ownerKey: string
  /** Keys a row written for this owner before may carry (resolved AppUser id, raw provider id). */
  ownerAliases: string[]
  /** Leave the chosen row's key as it is (its provider fetch failed, so nothing about it is current). */
  keepKey?: boolean
}

export type RosterWritePlan = {
  teamId: string
  /** The row to update, or null to create one. */
  rosterId: string | null
  /** The key to store: `ownerKey`, unless another row holds it (then see `keyConflict`). */
  ownerKey: string
  /** The row's key changes. */
  rekey: boolean
  /**
   * `ownerKey` is held by a row this import does not move, so it could not be used. An existing row
   * keeps its key; a new row is stored under the team's placeholder key instead.
   */
  keyConflict: boolean
}

export type RosterWritePlanResult = {
  plans: RosterWritePlan[]
  /** Rows bound to a team this import writes, other than the one chosen for it. */
  duplicateRows: number
}

/** A stored roster's provider team id, from either place an import records it. */
export function rosterSourceTeamId(playerData: unknown): string | null {
  if (!playerData || typeof playerData !== 'object' || Array.isArray(playerData)) return null
  const blob = playerData as Record<string, unknown>
  const direct = blob.source_team_id
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  if (typeof direct === 'number' && Number.isFinite(direct)) return String(direct)
  const meta = blob.import
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const nested = (meta as Record<string, unknown>).sourceTeamId
    if (typeof nested === 'string' && nested.trim()) return nested.trim()
  }
  return null
}

/** The key an orphan (managerless) imported team is stored under — one per team. */
export function importedOrphanOwnerKey(provider: string, teamId: string): string {
  return `orphan-${String(provider || 'import').trim().toLowerCase()}-${teamId}`
}

/** Where a new row goes when its owner's key is taken: a placeholder no manager can hold. */
export function importedPlaceholderOwnerKey(provider: string, teamId: string): string {
  return `import:${String(provider || 'import').trim().toLowerCase()}:${teamId}`
}

/**
 * The key an imported team's roster is stored under, in order:
 * - the AllFantasy account the manager is linked to;
 * - ⚠ the account that already CLAIMED the team — every "my roster" read keys on it, and a claim
 *   made through an invite is not something the manager resolver can see, so it must never be
 *   rewritten back to the provider id;
 * - the provider's manager id;
 * - the orphan key.
 */
export function importedRosterOwnerKey(args: {
  provider: string
  teamId: string
  linkedUserId?: string | null
  claimedByUserId?: string | null
  sourceManagerId?: string | null
}): string {
  const clean = (v: string | null | undefined) => String(v ?? '').trim()
  return (
    clean(args.linkedUserId) ||
    clean(args.claimedByUserId) ||
    clean(args.sourceManagerId) ||
    importedOrphanOwnerKey(args.provider, args.teamId)
  )
}

function playerCount(playerData: unknown): number {
  const players = (playerData as { players?: unknown } | null)?.players
  return Array.isArray(players) ? players.length : 0
}

/**
 * Among several rows bound to one team, the one to keep writing: the row already under the team's
 * key, then one under a key this owner had before, then one with any owner, then the fuller roster,
 * then the lower id — so the choice never depends on the order rows come back in.
 */
function rank(row: StoredRosterRow, team: IncomingTeam): number[] {
  const key = String(row.platformUserId ?? '')
  return [
    key === team.ownerKey ? 1 : 0,
    key.length > 0 && team.ownerAliases.includes(key) ? 1 : 0,
    key.trim().length > 0 ? 1 : 0,
    playerCount(row.playerData),
  ]
}

function outranks(a: StoredRosterRow, b: StoredRosterRow, team: IncomingTeam): boolean {
  const ra = rank(a, team)
  const rb = rank(b, team)
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] > rb[i]
  return a.id < b.id
}

export function planImportedRosterWrites(args: {
  provider: string
  incoming: ReadonlyArray<IncomingTeam>
  stored: ReadonlyArray<StoredRosterRow>
}): RosterWritePlanResult {
  const byTeam = new Map<string, StoredRosterRow[]>()
  const unbound: StoredRosterRow[] = []
  for (const row of args.stored) {
    const teamId = rosterSourceTeamId(row.playerData)
    if (teamId) byTeam.set(teamId, [...(byTeam.get(teamId) ?? []), row])
    else unbound.push(row)
  }

  // 1. Choose each team's row.
  const taken = new Set<string>()
  const chosen = new Map<string, StoredRosterRow | null>()
  let duplicateRows = 0
  for (const team of args.incoming) {
    const candidates = (byTeam.get(team.teamId) ?? []).filter((r) => !taken.has(r.id))
    let pick: StoredRosterRow | null = null
    for (const row of candidates) if (!pick || outranks(row, pick, team)) pick = row
    if (candidates.length > 1) duplicateRows += candidates.length - 1
    if (!pick) {
      // A row written before rows carried a team id: match it by owner, as the bootstrap always
      // did — but never a row bound to another team, and never on an empty key.
      const keys = new Set([team.ownerKey, ...team.ownerAliases].filter((k) => k.trim().length > 0))
      pick = unbound.find((r) => !taken.has(r.id) && keys.has(r.platformUserId)) ?? null
    }
    if (pick) taken.add(pick.id)
    chosen.set(team.teamId, pick)
  }

  // 2. Decide which rows move to their team's key. Start by moving every row whose key differs, then
  //    drop any move whose target would collide — with a row that stays, or with an earlier move to the
  //    same key — until nothing changes. A dropped move keeps its row where it is, which can block
  //    others, hence the loop. Moves among themselves (a chain, or two managers who swapped teams) are
  //    fine: the caller applies them in two steps through temporary keys.
  const moves = new Map<string, { teamId: string; from: string; to: string }>()
  for (const team of args.incoming) {
    const row = chosen.get(team.teamId)
    if (row && !team.keepKey && row.platformUserId !== team.ownerKey) {
      moves.set(row.id, { teamId: team.teamId, from: row.platformUserId, to: team.ownerKey })
    }
  }
  const blocked = new Set<string>()
  for (let changed = true; changed; ) {
    changed = false
    const staying = new Set<string>()
    for (const row of args.stored) if (!moves.has(row.id)) staying.add(row.platformUserId)
    const targets = new Set<string>()
    for (const [rowId, move] of moves) {
      if (staying.has(move.to) || targets.has(move.to)) {
        moves.delete(rowId)
        blocked.add(rowId)
        changed = true
        break
      }
      targets.add(move.to)
    }
  }

  // 3. Keys every row ends with, so a new row can take only a key nobody will hold.
  const finalKeys = new Set<string>()
  for (const row of args.stored) finalKeys.add(moves.get(row.id)?.to ?? row.platformUserId)

  const plans: RosterWritePlan[] = []
  for (const team of args.incoming) {
    const row = chosen.get(team.teamId) ?? null
    if (row) {
      const move = moves.get(row.id)
      plans.push({
        teamId: team.teamId,
        rosterId: row.id,
        ownerKey: move ? move.to : row.platformUserId,
        rekey: Boolean(move),
        keyConflict: blocked.has(row.id),
      })
      continue
    }
    const keyFree = !finalKeys.has(team.ownerKey)
    const ownerKey = keyFree ? team.ownerKey : importedPlaceholderOwnerKey(args.provider, team.teamId)
    finalKeys.add(ownerKey)
    plans.push({ teamId: team.teamId, rosterId: null, ownerKey, rekey: false, keyConflict: !keyFree })
  }
  return { plans, duplicateRows }
}
