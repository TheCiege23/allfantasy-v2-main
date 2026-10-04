import type { Prisma } from '@prisma/client'
import { leagueIdentityColumns } from '@/lib/player-identity/externalIdNamespace'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { rosterSourceTeamId } from '@/lib/league-import/importedRosterIdentity'
import { importedMlbScoring } from './importedMlbScoring'
import { copyImportedHistory } from './copyImportedHistory'
import { importedMlbRoster } from './importedMlbRoster'

type Tx = Prisma.TransactionClient

export class ImportedLeagueCarryoverError extends Error {}

function refuse(message: string): never {
  throw new ImportedLeagueCarryoverError(message)
}

type ImportedTeam = {
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
type ImportedRoster = {
  id: string
  platformUserId: string
  playerData: unknown
  faabRemaining: number | null
  waiverPriority: number | null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
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

/** Called inside the native creation transaction so a missing team or player rolls back the new league. */
export async function carryOverImportedLeague(tx: Tx, args: {
  sourceLeagueId: string
  targetLeagueId: string
  creatorUserId: string
  sport: string
  teamCount: number
}): Promise<number> {
  const [source, target, teams, rosters, slots, session] = await Promise.all([
    tx.league.findUnique({ where: { id: args.sourceLeagueId }, select: { platform: true, sport: true, settings: true, season: true } }),
    tx.league.findUnique({ where: { id: args.targetLeagueId }, select: { settings: true, season: true } }),
    tx.leagueTeam.findMany({
      where: { leagueId: args.sourceLeagueId, lifecycleState: { not: 'ARCHIVED' } },
      select: { id: true, externalId: true, platformUserId: true, claimedByUserId: true, teamName: true, ownerName: true, avatarUrl: true, isCommissioner: true, isCoCommissioner: true },
    }),
    tx.roster.findMany({ where: { leagueId: args.sourceLeagueId }, select: { id: true, platformUserId: true, playerData: true, faabRemaining: true, waiverPriority: true } }),
    tx.leagueEntrySlot.findMany({ where: { leagueId: args.targetLeagueId }, orderBy: { slotNumber: 'asc' }, select: { slotNumber: true, rosterId: true } }),
    tx.draftSession.findFirst({ where: { leagueId: args.targetLeagueId }, select: { id: true } }),
  ])
  if (!source || !target || isNativePlatform(source.platform) || String(source.sport) !== args.sport) {
    refuse('The imported league sport must match the standalone league.')
  }
  let mlbScoring: ReturnType<typeof importedMlbScoring> | undefined
  let mlbRoster: ReturnType<typeof importedMlbRoster> | undefined
  if (args.sport === 'MLB') {
    try { mlbScoring = importedMlbScoring(source.settings); mlbRoster = importedMlbRoster(source.settings) }
    catch (error) { refuse(error instanceof Error ? error.message : 'Imported scoring cannot be verified.') }
  }
  if (teams.length !== args.teamCount || slots.length !== args.teamCount || !session) {
    refuse('Team count must match the imported league exactly to carry over every roster.')
  }
  const creatorTeam = teams.find((team) => team.claimedByUserId === args.creatorUserId)
    ?? teams.find((team) => team.isCommissioner && !team.claimedByUserId)
  if (!creatorTeam) refuse('Claim your commissioner team in the import before carrying rosters over.')
  const orderedTeams = [creatorTeam, ...teams.filter((team) => team.id !== creatorTeam.id).sort((a, b) => a.externalId.localeCompare(b.externalId))]
  const sourceRosters = orderedTeams.map((team) => matchImportedRoster(team, rosters))
  if (new Set(sourceRosters.map((roster) => roster.id)).size !== sourceRosters.length) {
    refuse('Multiple imported teams point to the same roster. Refresh the import first.')
  }
  const sourcePlayerIdsByRoster = sourceRosters.map((roster) => importedOwnedPlayerIds(roster.playerData))
  const sourceIds = [...new Set(sourcePlayerIdsByRoster.flat())]
  const totalPlayers = sourcePlayerIdsByRoster.reduce((count, ids) => count + ids.length, 0)
  if (totalPlayers !== sourceIds.length) refuse('The import has duplicate player ownership. Refresh it before carrying rosters over.')
  const columns = leagueIdentityColumns(sourceIds, args.sport, source.platform)
  if (sourceIds.length && !columns.length) {
    refuse(`Player identities from ${source.platform} cannot yet be translated to a native roster.`)
  }
  const identities = sourceIds.length ? await tx.playerIdentityMap.findMany({
    where: { sport: args.sport, OR: columns.map(({ column, ids }) => ({ [column]: { in: ids } }) as Prisma.PlayerIdentityMapWhereInput) },
    select: { sleeperId: true, espnId: true, mflId: true, fleaflickerId: true, fantraxId: true, rollingInsightsId: true,
      canonicalName: true, position: true, currentTeam: true },
  }) : []
  const idMap = new Map<string, string>()
  const playerDetails = new Map<string, { name: string; position: string; team: string | null }>()
  for (const { column, ids } of columns) {
    const requested = new Set(ids)
    for (const identity of identities) {
      const sourceId = identity[column]
      if (!sourceId || !requested.has(sourceId)) continue
      const nativeId = args.sport === 'NFL' ? identity.sleeperId : identity.rollingInsightsId
      if (!nativeId || !identity.position || !identity.canonicalName) continue
      if (idMap.has(sourceId) && idMap.get(sourceId) !== nativeId) refuse(`Ambiguous imported player identity ${sourceId}.`)
      idMap.set(sourceId, nativeId)
      playerDetails.set(nativeId, { name: identity.canonicalName, position: identity.position, team: identity.currentTeam })
    }
  }
  if (String(source.platform).toLowerCase() === 'sleeper' && args.sport === 'NFL') {
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

  const picks: Prisma.DraftPickCreateManyInput[] = []
  const playerPicksBySlot: Array<Array<{ nativeId: string; name: string; position: string; team: string | null }>> = []
  const draftSlotOrder: Array<{ slot: number; rosterId: string; displayName: string; open: boolean }> = []
  const teamIds = new Map<string, string>()
  const rosterIds = new Map<string, string>()
  for (let i = 0; i < orderedTeams.length; i++) {
    const team = orderedTeams[i]!
    const sourceRoster = sourceRosters[i]!
    const slot = slots[i]!
    if (!slot.rosterId) refuse('A target roster seat is missing.')
    const targetRoster = await tx.roster.findUnique({ where: { id: slot.rosterId }, select: { id: true, platformUserId: true } })
    if (!targetRoster) refuse('A target roster is missing.')
    const claimedUserId = i === 0 ? args.creatorUserId : team.claimedByUserId
    const platformUserId = claimedUserId ?? targetRoster.platformUserId
    await tx.roster.update({
      where: { id: targetRoster.id },
      data: {
        platformUserId,
        playerData: translateImportedRosterData(sourceRoster.playerData, idMap, args.sourceLeagueId) as Prisma.InputJsonValue,
        faabRemaining: sourceRoster.faabRemaining,
        waiverPriority: sourceRoster.waiverPriority,
        settings: { openSlot: !claimedUserId, commissioner: i === 0 },
      },
    })
    const nativeTeam = await tx.leagueTeam.update({
      where: { leagueId_externalId: { leagueId: args.targetLeagueId, externalId: targetRoster.id } },
      data: {
        teamName: team.teamName,
        ownerName: team.ownerName,
        avatarUrl: team.avatarUrl,
        claimedByUserId: claimedUserId,
        platformUserId,
        isOrphan: !claimedUserId,
        isCommissioner: i === 0,
        isCoCommissioner: i > 0 && Boolean(team.isCoCommissioner),
        role: i === 0 ? 'commissioner' : team.isCoCommissioner ? 'co_commissioner' : 'member',
      },
    })
    teamIds.set(team.id, nativeTeam.id)
    teamIds.set(team.externalId, nativeTeam.id)
    rosterIds.set(sourceRoster.id, targetRoster.id)
    rosterIds.set(team.externalId, targetRoster.id)
    if (claimedUserId && i > 0) {
      await tx.redraftLeagueMember.create({ data: { leagueId: args.targetLeagueId, userId: claimedUserId, role: 'MEMBER', teamNumber: slot.slotNumber } })
      await tx.leagueEntrySlot.updateMany({ where: { leagueId: args.targetLeagueId, slotNumber: slot.slotNumber }, data: { status: 'FILLED' } })
    }
    draftSlotOrder.push({ slot: slot.slotNumber, rosterId: targetRoster.id, displayName: team.teamName, open: !claimedUserId })
    const rosterPicks: Array<{ nativeId: string; name: string; position: string; team: string | null }> = []
    for (const sourceId of sourcePlayerIdsByRoster[i]!) {
      const nativeId = idMap.get(sourceId)!
      const player = playerDetails.get(nativeId)!
      rosterPicks.push({ nativeId, ...player })
    }
    playerPicksBySlot.push(rosterPicks)
  }
  let overall = 1
  const maxPlayers = Math.max(0, ...playerPicksBySlot.map((rosterPicks) => rosterPicks.length))
  for (let roundIndex = 0; roundIndex < maxPlayers; roundIndex++) {
    for (let i = 0; i < playerPicksBySlot.length; i++) {
      const player = playerPicksBySlot[i]?.[roundIndex]
      if (!player) continue
      picks.push({
        sessionId: session.id, overall: overall++, round: roundIndex + 1,
        slot: slots[i]!.slotNumber, rosterId: slots[i]!.rosterId!, displayName: orderedTeams[i]!.teamName,
        playerId: player.nativeId, playerName: player.name, position: player.position, team: player.team,
        source: 'import', sportType: args.sport, pickedAt: new Date(),
        pickMetadata: { importedRosterSnapshot: true, sourceLeagueId: args.sourceLeagueId, sourceSeason: source.season, carriedIntoSeason: target.season },
      })
    }
  }
  await tx.draftSession.update({ where: { id: session.id }, data: {
    status: 'completed', completedAt: new Date(), draftModeLabel: 'imported_rosters',
    rounds: Math.max(1, maxPlayers),
    nextOverallPick: picks.length + 1, slotOrder: draftSlotOrder as Prisma.InputJsonValue,
  } })
  if (picks.length) await tx.draftPick.createMany({ data: picks })
  const history = await copyImportedHistory(tx, args.sourceLeagueId, args.targetLeagueId, teamIds, rosterIds)
  if (mlbScoring) {
    const slots = mlbRoster!.config.sections[0]!.slots
    await tx.leagueRosterConfig.upsert({ where: { leagueId: args.targetLeagueId }, create: { leagueId: args.targetLeagueId, templateId: `custom-MLB-${args.targetLeagueId}`, overrides: { customSlots: slots, customTemplateKey: 'imported', isCustom: true } }, update: { overrides: { customSlots: slots, customTemplateKey: 'imported', isCustom: true } } })
    await tx.leagueScoringOverride.deleteMany({ where: { leagueId: args.targetLeagueId } })
    await tx.leagueScoringOverride.createMany({ data: Object.entries(mlbScoring.templatePoints).map(([statKey, pointsValue]) => ({ leagueId: args.targetLeagueId, statKey, pointsValue, enabled: true })) })
    await tx.scoringSettingsSnapshot.updateMany({ where: { leagueId: args.targetLeagueId }, data: { scoringMode: 'points', scoringFormat: 'custom', effectiveRules: mlbScoring.scoringSettings as Prisma.InputJsonValue, overrides: mlbScoring.categoryPoints } })
  }
  await tx.league.update({ where: { id: args.targetLeagueId }, data: {
    settings: {
      ...asRecord(target.settings),
      ...(mlbScoring ? {
        roster: mlbRoster,
        rosterSettings: mlbRoster,
        starter_slots: mlbRoster?.starterSlots,
        bench_slots: mlbRoster?.benchSlots,
        mlb_roster_config: { templateKey: 'imported', templateLabel: 'Imported roster', slots: mlbRoster!.config.sections[0]!.slots, isCustom: true, lastUpdatedBy: args.creatorUserId, lastUpdatedAt: new Date().toISOString() },
        scoringSettings: mlbScoring.scoringSettings,
        sportConfig: { ...asRecord(asRecord(target.settings).sportConfig), scoringMode: 'points', categoryPoints: mlbScoring.categoryPoints },
        mlb_scoring_config: { presetKey: 'custom', source: 'CUSTOM', rules: mlbScoring.uiRules, lastUpdatedBy: args.creatorUserId, lastUpdatedAt: new Date().toISOString() },
      } : {}),
      importCarryover: { sourceLeagueId: args.sourceLeagueId, sourceSeason: source.season, history, teamCount: teams.length, playerCount: picks.length, copiedAt: new Date().toISOString() },
    } as Prisma.InputJsonValue,
  } })
  return picks.length
}
