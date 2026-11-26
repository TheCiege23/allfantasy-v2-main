import type { Prisma } from '@prisma/client'
import { GAMES_PER_WEEK_SETTINGS_KEY, readGamesPerWeek } from '@/lib/schedule-runtime/gamesPerWeek'
import type { importedNflScoring } from './importedNflScoring'
import { copyImportedHistory } from './copyImportedHistory'
import { isNativeFuturePickLeague, loadNativePickHorizonStart } from '@/lib/league-trade-engine/nativeFuturePicks'
import {
  asRecord,
  checkImportedSource,
  classifyImportedFuturePick,
  planImportedPlayerIdentity,
  readImportedSource,
  refuse,
  translateImportedRosterData,
} from './importedIdentityPlan'

/*
 * The translation and its refusals live in `./importedIdentityPlan`, shared with the planned
 * in-place switchover. These re-exports keep every existing importer (the creation route, the
 * carryover tests) on this module's path.
 */
export {
  ImportedLeagueCarryoverError,
  importedOwnedPlayerIds,
  matchImportedRoster,
  nativePlayerIdFor,
  translateImportedRosterData,
} from './importedIdentityPlan'

type Tx = Prisma.TransactionClient

type CarriedFuturePicks = { copied: number; skippedUnmapped: number; skippedNotTraded: number; skippedPastSeason: number }

/**
 * Copy the source league's traded future picks into the new native league, inside the creation
 * transaction.
 *
 * 🛑 A DYNASTY CARRYOVER USED TO DROP EVERY TRADED PICK. Imported picks live in `future_draft_picks`
 * keyed by the PROVIDER's team ids (`LeagueTeam.externalId`); a native dynasty league reads the same
 * table keyed by `Roster.id` (`nativeFuturePicks.ts`). Nothing moved them across, so a team that had
 * bought a 2027 1st arrived holding nothing and the seller was on the clock for it.
 *
 * Only rows that say something are copied: every team implicitly owns its own picks, so a row whose
 * holder is its original team is not a trade. A row naming a team that cannot be mapped is skipped
 * rather than guessed, and a season at or before the native horizon start is skipped because no
 * native rookie draft will ever consume it. `skipDuplicates` on the
 * (leagueId, pickSeason, round, originalRosterId) key keeps a retried carryover from duplicating rows.
 */
async function carryOverImportedFuturePicks(tx: Tx, args: {
  sourceLeagueId: string
  targetLeagueId: string
  /** Provider team id (`LeagueTeam.externalId`) → the new native `Roster.id`. */
  rosterIdByExternalId: Map<string, string>
}): Promise<CarriedFuturePicks | null> {
  const target = await tx.league.findUnique({
    where: { id: args.targetLeagueId },
    select: { platform: true, leagueType: true, isDynasty: true, season: true },
  })
  if (!target || !isNativeFuturePickLeague(target)) return null
  const rows = await tx.futureDraftPick.findMany({
    where: { leagueId: args.sourceLeagueId, status: 'active' },
    select: { pickSeason: true, round: true, originalRosterId: true, currentOwnerId: true, tradedAt: true },
  })
  const result: CarriedFuturePicks = { copied: 0, skippedUnmapped: 0, skippedNotTraded: 0, skippedPastSeason: 0 }
  if (!rows.length) return result
  const horizonStart = await loadNativePickHorizonStart(tx, args.targetLeagueId, target.season ?? null)
  const data: Prisma.FutureDraftPickCreateManyInput[] = []
  for (const row of rows) {
    const verdict = classifyImportedFuturePick(row, args.rosterIdByExternalId, horizonStart)
    if (verdict.kind === 'unmapped') { result.skippedUnmapped++; continue }
    if (verdict.kind === 'notTraded') { result.skippedNotTraded++; continue }
    if (verdict.kind === 'pastSeason') { result.skippedPastSeason++; continue }
    data.push({
      leagueId: args.targetLeagueId,
      pickSeason: row.pickSeason,
      round: row.round,
      originalRosterId: verdict.originalRosterId,
      currentOwnerId: verdict.currentOwnerId,
      traded: true,
      status: 'active',
      sourceTradeId: null,
      tradedAt: row.tradedAt ?? null,
    })
  }
  if (data.length) {
    const written = await tx.futureDraftPick.createMany({ data, skipDuplicates: true })
    result.copied = written?.count ?? data.length
  }
  return result
}

/** Called inside the native creation transaction so a missing team or player rolls back the new league. */
export async function carryOverImportedLeague(tx: Tx, args: {
  sourceLeagueId: string
  targetLeagueId: string
  creatorUserId: string
  sport: string
  teamCount: number
  acceptWeeklyLineups?: boolean
}): Promise<number> {
  const [read, target, slots, session] = await Promise.all([
    readImportedSource(tx, args.sourceLeagueId),
    tx.league.findUnique({ where: { id: args.targetLeagueId }, select: { settings: true, season: true } }),
    tx.leagueEntrySlot.findMany({ where: { leagueId: args.targetLeagueId }, orderBy: { slotNumber: 'asc' }, select: { slotNumber: true, rosterId: true } }),
    tx.draftSession.findFirst({ where: { leagueId: args.targetLeagueId }, select: { id: true } }),
  ])
  const { teams, rosters } = read
  if (!target) refuse('The imported league sport must match the standalone league.')
  const { source, mlbScoring, mlbRoster, nflScoring } = checkImportedSource(read.source, { sport: args.sport, acceptWeeklyLineups: args.acceptWeeklyLineups })
  if (teams.length !== args.teamCount || slots.length !== args.teamCount || !session) {
    refuse('Team count must match the imported league exactly to carry over every roster.')
  }
  const creatorTeam = teams.find((team) => team.claimedByUserId === args.creatorUserId)
    ?? teams.find((team) => team.isCommissioner && !team.claimedByUserId)
  if (!creatorTeam) refuse('Claim your commissioner team in the import before carrying rosters over.')
  const orderedTeams = [creatorTeam, ...teams.filter((team) => team.id !== creatorTeam.id).sort((a, b) => a.externalId.localeCompare(b.externalId))]
  const { sourceRosters, sourcePlayerIdsByRoster, idMap, playerDetails } = await planImportedPlayerIdentity(tx, {
    sport: args.sport, platform: source.platform, teams: orderedTeams, rosters,
  })

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
  const futurePicks = await carryOverImportedFuturePicks(tx, {
    sourceLeagueId: args.sourceLeagueId,
    targetLeagueId: args.targetLeagueId,
    rosterIdByExternalId: new Map(orderedTeams.map((team, i) => [team.externalId, slots[i]!.rosterId!])),
  })
  if (mlbScoring) {
    const slots = mlbRoster!.config.sections[0]!.slots
    await tx.leagueRosterConfig.upsert({ where: { leagueId: args.targetLeagueId }, create: { leagueId: args.targetLeagueId, templateId: `custom-MLB-${args.targetLeagueId}`, overrides: { customSlots: slots, customTemplateKey: 'imported', isCustom: true } }, update: { overrides: { customSlots: slots, customTemplateKey: 'imported', isCustom: true } } })
    await tx.leagueScoringOverride.deleteMany({ where: { leagueId: args.targetLeagueId } })
    await tx.leagueScoringOverride.createMany({ data: Object.entries(mlbScoring.templatePoints).map(([statKey, pointsValue]) => ({ leagueId: args.targetLeagueId, statKey, pointsValue, enabled: true })) })
    await tx.scoringSettingsSnapshot.updateMany({ where: { leagueId: args.targetLeagueId }, data: { scoringMode: mlbScoring.scoringMode, scoringFormat: 'custom', effectiveRules: mlbScoring.scoringSettings as Prisma.InputJsonValue, overrides: mlbScoring.categoryPoints } })
  }
  await tx.league.update({ where: { id: args.targetLeagueId }, data: {
    ...(mlbScoring?.scoringMode === 'roto' ? {playoffTeams:0,playoffStartWeek:null} : {}),
    settings: {
      ...asRecord(target.settings),
      ...(mlbScoring ? {
        roster: mlbRoster,
        rosterSettings: mlbRoster,
        starter_slots: mlbRoster?.starterSlots,
        bench_slots: mlbRoster?.benchSlots,
        mlb_roster_config: { templateKey: 'imported', templateLabel: 'Imported roster', slots: mlbRoster!.config.sections[0]!.slots, isCustom: true, lastUpdatedBy: args.creatorUserId, lastUpdatedAt: new Date().toISOString() },
        scoringSettings: mlbScoring.scoringSettings,
        scoring_mode: mlbScoring.scoringMode,
        category_preset_id: mlbScoring.categoryPresetId ?? null,
        category_record_mode: mlbScoring.categoryRecordMode ?? null,
        sportConfig: { ...asRecord(asRecord(target.settings).sportConfig), scoringMode: mlbScoring.scoringMode, categoryPoints: mlbScoring.categoryPoints, lineupLockType:'first_game_of_week' },
        mlb_scoring_config: { presetKey: 'custom', source: 'CUSTOM', rules: mlbScoring.uiRules, lastUpdatedBy: args.creatorUserId, lastUpdatedAt: new Date().toISOString() },
      } : {}),
      ...(nflScoring ? importedNflSettings(asRecord(target.settings), nflScoring, args.creatorUserId) : {}),
      // A league that played several games a week keeps doing so; the native schedule reads this setting.
      ...(readGamesPerWeek(source.settings) > 1 ? { [GAMES_PER_WEEK_SETTINGS_KEY]: readGamesPerWeek(source.settings) } : {}),
      importCarryover: { sourceLeagueId: args.sourceLeagueId, sourceSeason: source.season, history, teamCount: teams.length, playerCount: picks.length,
        ...(nflScoring ? { scoring: { convertedCount: nflScoring.convertedCount, notScored: nflScoring.notScored, approximated: nflScoring.approximated } } : {}),
        ...(futurePicks ? { futurePickCount: futurePicks.copied, futurePicksSkipped: futurePicks.skippedUnmapped + futurePicks.skippedNotTraded + futurePicks.skippedPastSeason } : {}),
        copiedAt: new Date().toISOString() },
    } as Prisma.InputJsonValue,
  } })
  return picks.length
}

/**
 * The settings keys an imported NFL rule set writes: the commissioner panel's store, marked
 * IMPORTED_MAPPED so post-create bootstrap does not re-seed the preset over it. Any engine-key
 * `categoryPoints` is removed because it outranks the panel store, and the imported rules must
 * be what scores.
 */
function importedNflSettings(
  target: Record<string, unknown>,
  nfl: NonNullable<ReturnType<typeof importedNflScoring>>,
  creatorUserId: string,
): Record<string, unknown> {
  const { categoryPoints: _replaced, ...sportConfig } = asRecord(target.sportConfig)
  return {
    nfl_scoring_config: {
      presetKey: 'custom',
      source: 'IMPORTED_MAPPED',
      rules: nfl.rules,
      matchesPreset: false,
      premiumFeaturesUsed: false,
      lastUpdatedAt: new Date().toISOString(),
      lastUpdatedBy: creatorUserId,
      warningFlags: nfl.notScored.length || nfl.approximated.length ? ['imported_rules_not_exact'] : [],
      importNotScored: nfl.notScored,
      importApproximated: nfl.approximated,
    },
    sportConfig: { ...sportConfig, ...(nfl.enableTEPremium ? { enableTEPremium: true } : {}) },
  }
}
