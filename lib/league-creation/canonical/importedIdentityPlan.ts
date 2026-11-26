import type { Prisma } from '@prisma/client'
import { leagueIdentityColumns } from '@/lib/player-identity/externalIdNamespace'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { rosterSourceTeamId } from '@/lib/league-import/importedRosterIdentity'
import { importedMlbScoring } from './importedMlbScoring'
import { importedNflScoring } from './importedNflScoring'
import { importedMlbRoster } from './importedMlbRoster'

/**
 * Translating an imported league's identities into native ones: which roster is each team's, which
 * native player each provider player id is, and which seat holds each traded future pick.
 *
 * WHY THIS IS ITS OWN MODULE. `carryOverImportedLeague` copies an import into a NEW native league.
 * The planned in-place switchover (docs/league-import/IN_PLACE_NATIVE_CONVERSION_PLAN.md) turns the
 * SAME row native, and it needs exactly the same translation and exactly the same refusals. Two
 * copies of these rules would drift. So everything here reads the source and decides; nothing here
 * writes. The two appliers decide where the result goes.
 *
 * ⚠ THE STEPS ARE SEPARATE ON PURPOSE, SO A CALLER CAN KEEP ITS REFUSAL ORDER. The copy applier
 * checks its target (team count, the creator's team) between reading the source and translating
 * players, and a commissioner sees whichever refusal comes first. Merging these into one call would
 * reorder those messages.
 */

type Tx = Prisma.TransactionClient

export class ImportedLeagueCarryoverError extends Error {}

export function refuse(message: string): never {
  throw new ImportedLeagueCarryoverError(message)
}

export type ImportedTeam = {
  id: string
  externalId: string
  platformUserId: string | null
  claimedByUserId: string | null
  teamName: string
  ownerName: string
  avatarUrl: string | null
  isCommissioner: boolean
  isCoCommissioner?: boolean
}
export type ImportedRoster = {
  id: string
  platformUserId: string
  playerData: unknown
  faabRemaining: number | null
  waiverPriority: number | null
}
export type ImportedSourceLeague = { platform: string; sport: unknown; settings: unknown; season: number | null }
export type NativePlayerDetails = { name: string; position: string; team: string | null }

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/**
 * The id a native roster holds for an imported player. NFL: the Sleeper id. NCAAF: the CFBD pool id first, then the
 * Rolling Insights id -- the native NCAAF pool prefers a CFBD row over an RI duplicate
 * (lib/sport-teams/SportPlayerPoolResolver.ts), campus scoring reads a numeric id as a CFBD id, and college players
 * are linked by CFBD id (lib/player-identity/ingestNcaafFantraxIdentities.ts). Reading only the RI id refused
 * nearly every college player in an NCAAF carryover (2026-11-26, Road To Glory). Every other sport: the RI id.
 */
export function nativePlayerIdFor(
  sport: string,
  identity: { sleeperId?: string | null; rollingInsightsId?: string | null; cfbdId?: string | null },
): string | null {
  const s = String(sport).trim().toUpperCase()
  if (s === 'NFL') return identity.sleeperId ?? null
  if (s === 'NCAAF') return identity.cfbdId ?? identity.rollingInsightsId ?? null
  return identity.rollingInsightsId ?? null
}

export function matchImportedRoster(team: ImportedTeam, rosters: ImportedRoster[]): ImportedRoster {
  const byTeamId = rosters.filter((roster) => rosterSourceTeamId(roster.playerData) === team.externalId)
  const candidates = byTeamId.length ? byTeamId : rosters.filter((roster) =>
    // Older imports can lack a team marker. A marker for another team is never a safe fallback.
    Boolean(team.platformUserId) && roster.platformUserId === team.platformUserId && !rosterSourceTeamId(roster.playerData),
  )
  if (candidates.length !== 1) {
    refuse(`Cannot identify one current roster for imported team ${team.teamName}. Refresh the import before creating a standalone league.`)
  }
  return candidates[0]!
}

function mapPlayerRows(rows: unknown, idMap: Map<string, string>): unknown {
  if (!Array.isArray(rows)) return rows
  return rows.map((row) => {
    if (typeof row === 'string' || typeof row === 'number') return idMap.get(String(row)) ?? row
    const obj = asRecord(row)
    if (!Object.keys(obj).length) return row
    const id = String(obj.id ?? obj.player_id ?? '')
    const mapped = idMap.get(id)
    return mapped ? { ...obj, ...(obj.id != null ? { id: mapped } : {}), ...(obj.player_id != null ? { player_id: mapped } : {}) } : row
  })
}

function rowIds(rows: unknown): string[] {
  if (!Array.isArray(rows)) return []
  return rows.map((row) => typeof row === 'string' || typeof row === 'number' ? String(row) : String(asRecord(row).id ?? asRecord(row).player_id ?? ''))
    .filter(Boolean)
}

export function importedOwnedPlayerIds(data: unknown): string[] {
  const raw = asRecord(data)
  const sections = asRecord(raw.lineup_sections)
  const lineupIds = [...new Set([
    ...rowIds(raw.starters), ...rowIds(raw.reserve), ...rowIds(raw.taxi),
    ...Object.values(sections).flatMap(rowIds),
  ])]
  const ownedIds = [...new Set(getRosterPlayerIds(data).map(String))]
  if (!ownedIds.length) return lineupIds
  const owned = new Set(ownedIds)
  if (lineupIds.some((id) => !owned.has(id))) {
    refuse('An imported lineup contains a player missing from its team roster. Refresh the import before carrying it over.')
  }
  return ownedIds
}

export function translateImportedRosterData(data: unknown, idMap: Map<string, string>, sourceLeagueId: string): Record<string, unknown> {
  const raw = asRecord(data)
  const players = Array.isArray(data) ? data : Array.isArray(raw.players) && raw.players.length ? raw.players : importedOwnedPlayerIds(data)
  const sections = asRecord(raw.lineup_sections)
  const { source_provider: _provider, source_league_id: _sourceId, source_team_id: _teamId,
    source_manager_id: _managerId, source_season_id: _seasonId, import_batch_id: _batchId,
    imported_at: _importedAt, import: _import,
    // A source draft's marker must not make native finalization rebuild the carried lineup.
    lineup_draft_session_id: _sourceDraftSession, ...rest } = raw
  return {
    ...rest,
    players: mapPlayerRows(players, idMap) ?? [],
    starters: mapPlayerRows(raw.starters, idMap) ?? [],
    reserve: mapPlayerRows(raw.reserve, idMap) ?? [],
    taxi: mapPlayerRows(raw.taxi, idMap) ?? [],
    lineup_sections: Object.fromEntries(Object.entries(sections).map(([key, rows]) => [key, mapPlayerRows(rows, idMap)])),
    draftPicks: [],
    foundation: { ...asRecord(raw.foundation), openTeam: false, carriedOverFromLeagueId: sourceLeagueId },
  }
}

/** Reads only. Every check on what comes back is the caller's, in the caller's order. */
export async function readImportedSource(tx: Tx, sourceLeagueId: string): Promise<{
  source: ImportedSourceLeague | null
  teams: ImportedTeam[]
  rosters: ImportedRoster[]
}> {
  const [source, teams, rosters] = await Promise.all([
    tx.league.findUnique({ where: { id: sourceLeagueId }, select: { platform: true, sport: true, settings: true, season: true } }),
    tx.leagueTeam.findMany({
      where: { leagueId: sourceLeagueId, lifecycleState: { not: 'ARCHIVED' } },
      select: { id: true, externalId: true, platformUserId: true, claimedByUserId: true, teamName: true, ownerName: true, avatarUrl: true, isCommissioner: true, isCoCommissioner: true },
    }),
    tx.roster.findMany({ where: { leagueId: sourceLeagueId }, select: { id: true, platformUserId: true, playerData: true, faabRemaining: true, waiverPriority: true } }),
  ])
  return { source: source as ImportedSourceLeague | null, teams: teams as ImportedTeam[], rosters: rosters as ImportedRoster[] }
}

/**
 * The source must be an import of the same sport, and an MLB league must convert its scoring and
 * roster exactly or not at all. NFL scoring is best effort and never refuses: null keeps the preset
 * the creator picked (owner, 2026-10-25).
 */
export function checkImportedSource(source: ImportedSourceLeague | null, args: { sport: string; acceptWeeklyLineups?: boolean }): {
  source: ImportedSourceLeague
  mlbScoring: ReturnType<typeof importedMlbScoring> | undefined
  mlbRoster: ReturnType<typeof importedMlbRoster> | undefined
  nflScoring: ReturnType<typeof importedNflScoring> | null
} {
  if (!source || isNativePlatform(source.platform) || String(source.sport) !== args.sport) {
    refuse('The imported league sport must match the standalone league.')
  }
  let mlbScoring: ReturnType<typeof importedMlbScoring> | undefined
  let mlbRoster: ReturnType<typeof importedMlbRoster> | undefined
  if (args.sport === 'MLB') {
    if (args.acceptWeeklyLineups !== true) refuse('Confirm weekly lineups for the native baseball league. Source daily lineup history stays archived; native scoring uses one lineup per week.')
    try { mlbScoring = importedMlbScoring(source.settings); mlbRoster = importedMlbRoster(source.settings) }
    catch (error) { refuse(error instanceof Error ? error.message : 'Imported scoring cannot be verified.') }
  }
  const nflScoring = args.sport === 'NFL' ? importedNflScoring(source.settings) : null
  return { source, mlbScoring, mlbRoster, nflScoring }
}

export type ImportedPlayerIdentityPlan = {
  /** Index-aligned with the `teams` passed in. */
  sourceRosters: ImportedRoster[]
  /** Index-aligned with the `teams` passed in: each team's provider player ids. */
  sourcePlayerIdsByRoster: string[][]
  /** Provider player id → native player id. Complete for every id above, or the plan refused. */
  idMap: Map<string, string>
  /** Native player id → the name, position and team a native draft pick needs. */
  playerDetails: Map<string, NativePlayerDetails>
}

/**
 * One roster per team, one owner per player, and one native id per provider id — or a refusal.
 * `teams` order is the caller's: the result is index-aligned with it.
 */
export async function planImportedPlayerIdentity(tx: Tx, args: {
  sport: string
  platform: string
  teams: ImportedTeam[]
  rosters: ImportedRoster[]
}): Promise<ImportedPlayerIdentityPlan> {
  const sourceRosters = args.teams.map((team) => matchImportedRoster(team, args.rosters))
  if (new Set(sourceRosters.map((roster) => roster.id)).size !== sourceRosters.length) {
    refuse('Multiple imported teams point to the same roster. Refresh the import first.')
  }
  const sourcePlayerIdsByRoster = sourceRosters.map((roster) => importedOwnedPlayerIds(roster.playerData))
  const sourceIds = [...new Set(sourcePlayerIdsByRoster.flat())]
  const totalPlayers = sourcePlayerIdsByRoster.reduce((count, ids) => count + ids.length, 0)
  if (totalPlayers !== sourceIds.length) refuse('The import has duplicate player ownership. Refresh it before carrying rosters over.')
  const columns = leagueIdentityColumns(sourceIds, args.sport, args.platform)
  if (sourceIds.length && !columns.length) {
    refuse(`Player identities from ${args.platform} cannot yet be translated to a native roster.`)
  }
  const identities = sourceIds.length ? await tx.playerIdentityMap.findMany({
    where: { sport: args.sport, OR: columns.map(({ column, ids }) => ({ [column]: { in: ids } }) as Prisma.PlayerIdentityMapWhereInput) },
    select: { sleeperId: true, espnId: true, mflId: true, fleaflickerId: true, fantraxId: true, rollingInsightsId: true, cfbdId: true,
      canonicalName: true, position: true, currentTeam: true },
  }) : []
  const idMap = new Map<string, string>()
  const playerDetails = new Map<string, NativePlayerDetails>()
  for (const { column, ids } of columns) {
    const requested = new Set(ids)
    for (const identity of identities) {
      const sourceId = identity[column]
      if (!sourceId || !requested.has(sourceId)) continue
      const nativeId = nativePlayerIdFor(args.sport, identity)
      if (!nativeId || !identity.position || !identity.canonicalName) continue
      if (idMap.has(sourceId) && idMap.get(sourceId) !== nativeId) refuse(`Ambiguous imported player identity ${sourceId}.`)
      idMap.set(sourceId, nativeId)
      playerDetails.set(nativeId, { name: identity.canonicalName, position: identity.position, team: identity.currentTeam })
    }
  }
  if (String(args.platform).toLowerCase() === 'sleeper' && args.sport === 'NFL') {
    const unresolved = sourceIds.filter((id) => !idMap.has(id))
    if (unresolved.length) {
      const directPlayers = await tx.player.findMany({ where: { id: { in: unresolved }, sport: args.sport }, select: { id: true, name: true, position: true, team: true } })
      for (const player of directPlayers) {
        idMap.set(player.id, player.id)
        playerDetails.set(player.id, { name: player.name, position: player.position, team: player.team })
      }
    }
  }
  const missing = sourceIds.filter((id) => !idMap.has(id))
  if (missing.length) refuse(`${missing.length} imported player IDs cannot be verified for a native league. Refresh player identities before carrying rosters over.`)
  if (new Set(sourceIds.map((id) => idMap.get(id))).size !== sourceIds.length) {
    refuse('Multiple imported player IDs map to one native player. Refresh player identities before carrying rosters over.')
  }
  return { sourceRosters, sourcePlayerIdsByRoster, idMap, playerDetails }
}

export type ImportedFuturePickVerdict =
  | { kind: 'unmapped' }
  | { kind: 'notTraded' | 'pastSeason' | 'traded'; originalRosterId: string; currentOwnerId: string }

/**
 * Where one imported future pick lands natively. Imported picks are keyed by the PROVIDER's team ids
 * (`LeagueTeam.externalId`); native ones by `Roster.id` (`nativeFuturePicks.ts`).
 *
 * The checks run in this order, and the first that applies wins: a team that cannot be mapped, a
 * pick still held by its original team (not a trade), then a season at or before the native horizon
 * start (no native rookie draft will ever consume it). Mapped ids come back for every verdict but
 * `unmapped`, so an applier that rewrites ALL rows (in place) and one that copies only trades
 * (carryover) read the same answer.
 */
export function classifyImportedFuturePick(
  row: { pickSeason: number; originalRosterId: string; currentOwnerId: string },
  rosterIdByExternalId: Map<string, string>,
  horizonStart: number | null,
): ImportedFuturePickVerdict {
  const originalRosterId = rosterIdByExternalId.get(row.originalRosterId)
  const currentOwnerId = rosterIdByExternalId.get(row.currentOwnerId)
  if (!originalRosterId || !currentOwnerId) return { kind: 'unmapped' }
  if (originalRosterId === currentOwnerId) return { kind: 'notTraded', originalRosterId, currentOwnerId }
  if (horizonStart == null || row.pickSeason < horizonStart) return { kind: 'pastSeason', originalRosterId, currentOwnerId }
  return { kind: 'traded', originalRosterId, currentOwnerId }
}
