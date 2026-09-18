/**
 * Which stored `Roster` row belongs to which `LeagueTeam`. ONE rule, for every reader.
 *
 * 🛑 THE OWNER KEY STOPPED BEING THE TEAM'S KEY, AND MOST READERS NEVER LEARNED. PR #1005 moved a
 * managerless team's roster to `orphan-<provider>-<teamId>` and made a team whose manager changed
 * keep its old row. Neither is reachable from a manager id — which was the only thing most of these
 * joins knew.
 *
 * Measured read-only on production 2026-09-17, across a 19-module census:
 * - 210 of 4,125 teams in rostered leagues matched NO roster by manager id; 201 are recoverable by
 *   `source_team_id`, across 32 current-season leagues.
 * - ⚠ CLAIMED teams are NOT the victims — #1005 kept all 299 claimed rosters under the claimant key.
 *   The damage is to the OTHER teams in the league: 60 matchups of a claimed team in 16 leagues, over
 *   all 18 weeks, are against a team whose roster resolves to nothing. That is the em-dash
 *   "— v 161.7" symptom `nextMatchup.ts` documents, arriving from the opponent's side.
 *
 * The rule, strongest evidence first, applied one pass at a time ACROSS ALL TEAMS so that a weak
 * match can never take a row a stronger one needs:
 *   1. `playerData.source_team_id` → `LeagueTeam.externalId` — the provider's own team id, which
 *      every import writes and #1005 made the write side key on;
 *   2. `playerData.source_manager_id` → `LeagueTeam.platformUserId`;
 *   3. `Roster.platformUserId` → the team's owner keys, in the caller's order.
 *
 * ⚠ RULE 1 IS ADDED IN FRONT OF THE OWNER RULES, NEVER IN PLACE OF THEM. On the same measurement the
 * rules never disagree (0 of 3,822 teams matched by both resolve to different rows), but 93 teams
 * match ONLY on an owner key — rows written before imports recorded a team id.
 *
 * Pure: no IO, no prisma, no writes. `assemble.ts` re-exports `matchTeamIdForRoster` from here, so
 * the Decision OS canonical world and the app surfaces cannot drift apart.
 */

export type RosterIdentityRow = {
  id?: string | null
  platformUserId: string | null
  playerData: unknown
}

export type TeamIdentityRow = {
  id?: string | null
  externalId: string | null
  platformUserId?: string | null
  claimedByUserId?: string | null
}

function readString(blob: Record<string, unknown> | null, key: string): string | null {
  const direct = blob?.[key]
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  if (typeof direct === 'number' && Number.isFinite(direct)) return String(direct)
  return null
}

function asBlob(playerData: unknown): Record<string, unknown> | null {
  return playerData && typeof playerData === 'object' && !Array.isArray(playerData)
    ? (playerData as Record<string, unknown>)
    : null
}

/** The provider team id an import recorded, from either place it writes it. */
export function readSourceTeamId(roster: Pick<RosterIdentityRow, 'playerData'>): string | null {
  const blob = asBlob(roster.playerData)
  const direct = readString(blob, 'source_team_id')
  if (direct) return direct
  return readString(asBlob(blob?.import), 'sourceTeamId')
}

/** The provider manager id an import recorded, from either place it writes it. */
export function readSourceManagerId(roster: Pick<RosterIdentityRow, 'playerData'>): string | null {
  const blob = asBlob(roster.playerData)
  const direct = readString(blob, 'source_manager_id')
  if (direct) return direct
  return readString(asBlob(blob?.import), 'sourceManagerId')
}

/**
 * Pure, write-free resolution of which canonical team a roster belongs to — the roster's view of the
 * rule above. Returns the team's `id`, or null when nothing matches (a completeness warning to the
 * caller, never repaired here).
 */
export function matchTeamIdForRoster(
  roster: Pick<RosterIdentityRow, 'playerData' | 'platformUserId'>,
  teams: ReadonlyArray<TeamIdentityRow>,
): string | null {
  const sourceTeamId = readSourceTeamId(roster)
  if (sourceTeamId) {
    const byExternal = teams.find((t) => t.externalId === sourceTeamId)
    if (byExternal?.id) return byExternal.id
  }
  if (roster.platformUserId) {
    const byPlatformUser = teams.find((t) => t.platformUserId === roster.platformUserId)
    if (byPlatformUser?.id) return byPlatformUser.id
    const byClaim = teams.find((t) => t.claimedByUserId === roster.platformUserId)
    if (byClaim?.id) return byClaim.id
  }
  return null
}

function playerCount(playerData: unknown): number {
  const players = asBlob(playerData)?.players
  return Array.isArray(players) ? players.length : 0
}

/**
 * Among several rows bound to one team, the one to read: the fuller roster, then the lower id — the
 * write side's own tie-break (`importedRosterIdentity.rank`).
 *
 * ⚠ IT DISCRIMINATES NOTHING TODAY, AND IS HERE FOR DETERMINISM. Six teams in production carry two
 * rows under one team id (the duplicates #1005 deliberately left in place), and all six pairs hold
 * IDENTICAL players and starters. So the value of this is that the answer cannot depend on the order
 * rows come back in — not that it picks a better row, which would overstate it.
 */
function better(a: RosterIdentityRow, b: RosterIdentityRow): boolean {
  const diff = playerCount(a.playerData) - playerCount(b.playerData)
  if (diff !== 0) return diff > 0
  return String(a.id ?? '') < String(b.id ?? '')
}

/**
 * One roster per team, keyed by the team's `externalId`.
 *
 * `ownerKeysFor` supplies the team's owner keys for rule 3, in the caller's own order — the caller
 * knows things this module must not guess, such as that the SIGNED-IN user's uuid may key their own
 * roster but is never a way to find someone else's (`myRosterCandidates`).
 */
export function resolveRostersForTeams<T extends TeamIdentityRow, R extends RosterIdentityRow>(
  teams: readonly T[],
  rosters: readonly R[],
  ownerKeysFor: (team: T) => ReadonlyArray<string | null | undefined> = (t) => [t.platformUserId, t.externalId],
): Map<string, R> {
  const out = new Map<string, R>()
  const used = new Set<R>()
  const open = teams.filter((t): t is T & { externalId: string } => Boolean(t.externalId))

  const take = (team: T & { externalId: string }, row: R) => {
    out.set(team.externalId, row)
    used.add(row)
  }

  /* Rule 1, for every team, before any weaker rule can spend a row. */
  for (const team of open) {
    let best: R | null = null
    for (const row of rosters) {
      if (used.has(row) || readSourceTeamId(row) !== team.externalId) continue
      if (!best || better(row, best)) best = row
    }
    if (best) take(team, best)
  }

  /* Rule 2. */
  for (const team of open) {
    if (out.has(team.externalId) || !team.platformUserId) continue
    const row = rosters.find((r) => !used.has(r) && readSourceManagerId(r) === team.platformUserId)
    if (row) take(team, row)
  }

  /* Rule 3. */
  for (const team of open) {
    if (out.has(team.externalId)) continue
    const keys = [...new Set(ownerKeysFor(team).filter((k): k is string => typeof k === 'string' && k.length > 0))]
    for (const key of keys) {
      const row = rosters.find((r) => !used.has(r) && r.platformUserId === key)
      if (row) {
        take(team, row)
        break
      }
    }
  }

  return out
}
