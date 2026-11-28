import { randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import {
  asRecord,
  checkImportedSource,
  ImportedLeagueCarryoverError,
  planImportedPlayerIdentity,
  readImportedSource,
  translateImportedRosterData,
  type ImportedRoster,
  type ImportedTeam,
} from '@/lib/league-creation/canonical/importedIdentityPlan'
import { checkNativeReadiness, type NativeReadinessItem } from '@/lib/league/nativeReadiness'
import { copyProviderWeeklyScores, type ProviderScoreCopy } from '@/lib/league/copyProviderWeeklyScores'
import { planImportedRosterLayout, savedInAllFantasy, sportScoringStore } from '@/lib/league/nativeScaffolding'
import {
  importedGamesPerWeekSettings,
  importedMlbLeagueColumns,
  importedMlbSettings,
  importedNflSettings,
  writeImportedMlbScoringTables,
} from '@/lib/league-creation/canonical/importedScoringSettings'
import { inviteMaxUsesFor } from '@/lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { writeLeagueRosterConfig } from '@/lib/roster-engine/UnifiedRosterConfigService'
import { bootstrapLeagueWaiverSettings } from '@/lib/waiver-defaults/LeagueWaiverBootstrapService'
import { ensureLeagueSettingsRow } from '@/lib/draft-defaults/ensureLeagueSettingsRow'

/**
 * Switch an imported league to running on AllFantasy IN PLACE — same League row, id, link, chat and history.
 * docs/league-import/IN_PLACE_NATIVE_CONVERSION_PLAN.md §7, step 4a of §14.
 *
 * ONE TRANSACTION. It locks the league row, re-runs the readiness checks against the locked state (a sync can change a
 * roster between the commissioner's last look and now), snapshots every row it is about to change into
 * `LeagueNativeConversion`, rewrites every provider-keyed id to its native form, and flips `platform` LAST. Any refusal
 * or error rolls all of it back, and the league is still a working import.
 *
 * NATIVE SETTINGS (step 4b-1, nativeScaffolding.ts). Without them a converted league silently plays AllFantasy DEFAULTS:
 * scoring falls to standard PPR and the roster to a default template most imported rosters overflow. So the switch
 * carries the provider's scoring (NFL/MLB, the copy flow's converters) and roster layout, unless the commissioner
 * already saved their own in AllFantasy, which wins (Q8). The roster write goes through the one roster writer, which
 * cannot join this transaction, so it runs just BEFORE it: harmless on an imported league, which reads the
 * provider's positions first while it is imported.
 *
 * PAST WEEKS (step 4b-2, copyProviderWeeklyScores.ts): the season's provider matchups and per-player points are copied
 * into AllFantasy's own tables (Q4), before the flip, while the provider league id still names their rows.
 *
 * UNDO (step 6, undoNativeConversion.ts) reads the snapshot written in step 12; anything this function changes must be
 * recorded there, or undo cannot put it back. The first conversions are supervised (plan §8).
 *
 * What it keeps, by the owner's decisions (§13): team names, logos and the provider manager name on every seat,
 * claimed or not (Q3); carried players become ordinary drafted players (Q6).
 */

type Tx = Prisma.TransactionClient

export class NativeConversionRefusal extends Error {
  constructor(message: string, readonly blockers: NativeReadinessItem[] = []) {
    super(message)
  }
}

/**
 * The pre-switch state of every row the switch changes, so undo (step 6, undoNativeConversion.ts) can put it back.
 * Shape version 1. Fields marked "step 6" were added with undo and are optional: a snapshot written before them still
 * undoes, it just cannot put back what it did not record (undo says which).
 */
export type NativeConversionSnapshotV1 = {
  version: 1
  league: {
    platform: string; platformLeagueId: string; syncStatus: string | null; settings: unknown
    /** Step 6: the columns a baseball roto conversion overwrites. */
    columns?: { playoffTeams: number | null; playoffStartWeek: number | null }
  }
  /** Step 6: the season the switch converted. Undo closes once the league has a newer one (Q10). */
  seasonAtSwitch?: { id: string; season: number } | null
  teams: Array<{
    id: string; externalId: string; platformUserId: string | null; isOrphan: boolean; role: string
    /** Step 6: what claiming a seat after the switch overwrites. */
    ownerName?: string | null; teamName?: string | null; avatarUrl?: string | null; claimedByUserId?: string | null
    isCommissioner?: boolean; isCoCommissioner?: boolean
  }>
  rosters: Array<{ id: string; platformUserId: string; managerUserId: string | null; redraftRosterId: string | null; playerData: unknown; settings: unknown }>
  redraftRosters: Array<{ id: string; ownerId: string; managerUserId: string | null; ownerName?: string | null; teamName?: string | null }>
  redraftPlayers: Array<{ id: string; playerId: string; acquisitionType: string }>
  futurePicks: Array<{ id: string; originalRosterId: string; currentOwnerId: string }>
  draftSessions: Array<{ id: string; sleeperDraftId: string | null; slotOrder: unknown }>
  history: {
    matchupFacts: Array<{ id: string; teamA: string; teamB: string; winnerTeamId: string | null }>
    seasonStandingFacts: Array<{ id: string; teamId: string }>
    rosterSnapshots: Array<{ id: string; teamId: string }>
    seasonResults: Array<{ id: string; rosterId: string }>
    leagueSeasons: Array<{ id: string; teamRecords: unknown }>
  }
  /** Rows the switch created and undo must delete; plus slots it changed, with their old values. */
  created: { memberIds: string[]; chatRoomIds: string[]; entrySlotIds: string[]; inviteIds?: string[] }
  /**
   * Rows the past-week copy wrote, for undo: these matchups, and the native player rows for this season. Step 6:
   * `playerScoresPreexisted` says native rows for that season were already there, so undo must not delete by season.
   */
  copiedScores?: { matchupIds: string[]; playerScoresSeasonYear: number; playerScoresPreexisted?: boolean }
  /** Baseball only: the scoring tables the switch replaced, as they were (the copy flow's converter rewrites them). */
  mlbTablesBefore?: {
    rosterConfig: unknown; scoringOverrides: unknown[]
    /** Step 6: the scoring snapshots the converter rewrites in place. */
    scoringSnapshots?: Array<{ id: string; scoringMode: string; scoringFormat: string | null; effectiveRules: unknown; overrides: unknown }>
  }
  entrySlotsBefore: Array<{ id: string; rosterId: string | null; status: string }>
}

export type NativeSeat = {
  slotNumber: number
  teamId: string
  rosterId: string
  /** The AppUser who holds this seat, or null for an open seat. */
  claimedUserId: string | null
  /** `Roster.platformUserId` and `RedraftRoster.ownerId` after the switch: they must stay identical (standingsEngine). */
  ownerKey: string
  /** Set on a manager's second and later teams, whose `ownerKey` cannot repeat their user id. */
  managerUserId: string | null
}

/**
 * The native key every seat gets. A claimed seat is keyed by its user's id; the same user's second team keeps a key of
 * its own and names them in `managerUserId` (the `finalizeDraftToRedraftSeason` convention); an open seat gets the
 * `open-slot-<leagueId>-<n>` key that join, resize and readiness readers recognise.
 */
export function assignNativeSeats(leagueId: string, teams: ImportedTeam[], rosters: ImportedRoster[]): NativeSeat[] {
  const seen = new Set<string>()
  return teams.map((team, i) => {
    const rosterId = rosters[i]!.id
    const claimedUserId = team.claimedByUserId ?? null
    let ownerKey: string
    let managerUserId: string | null = null
    if (!claimedUserId) ownerKey = `open-slot-${leagueId}-${i + 1}`
    else if (!seen.has(claimedUserId)) { ownerKey = claimedUserId; seen.add(claimedUserId) }
    else { ownerKey = `roster:${rosterId}`; managerUserId = claimedUserId }
    return { slotNumber: i + 1, teamId: team.id, rosterId, claimedUserId, ownerKey, managerUserId }
  })
}

/** The commissioner's own team first, as canonical create seats them, then the rest in provider order. */
export function orderTeamsForSeats(teams: ImportedTeam[], userId: string): ImportedTeam[] {
  const first = teams.find((t) => t.claimedByUserId === userId) ?? teams.find((t) => t.isCommissioner) ?? null
  const rest = teams.filter((t) => t !== first).sort((a, b) => a.externalId.localeCompare(b.externalId))
  return first ? [first, ...rest] : rest
}

/** Rewrite `rosterId` entries in a draft session's `slotOrder` from provider team ids to `Roster.id`. */
export function remapSlotOrder(slotOrder: unknown, rosterIdByExternalId: Map<string, string>): unknown {
  if (!Array.isArray(slotOrder)) return slotOrder
  return slotOrder.map((entry) => {
    const row = asRecord(entry)
    const mapped = row.rosterId != null ? rosterIdByExternalId.get(String(row.rosterId)) : undefined
    return mapped ? { ...row, rosterId: mapped } : entry
  })
}

/** The `copyImportedHistory` rule, in place: `teamId` keys map to `LeagueTeam.id`, `rosterId` keys to `Roster.id`. */
export function remapTeamRecords(value: unknown, teamIdByKey: Map<string, string>, rosterIdByKey: Map<string, string>): unknown {
  if (!Array.isArray(value)) return value
  return value.map((entry) => {
    const row = asRecord(entry)
    if (!Object.keys(row).length) return entry
    const next = { ...row }
    for (const key of ['teamId', 'team_id']) {
      const mapped = row[key] != null ? teamIdByKey.get(String(row[key])) : undefined
      if (mapped) next[key] = mapped
    }
    const mapped = row.rosterId != null ? rosterIdByKey.get(String(row.rosterId)) : undefined
    if (mapped) { next.rosterId = mapped; next.sourceRosterId = row.rosterId }
    return next
  })
}

function refuse(message: string, blockers: NativeReadinessItem[] = []): never {
  throw new NativeConversionRefusal(message, blockers)
}

export type NativeConversionResult =
  | {
      kind: 'converted'
      conversionId: string
      seats: number
      players: number
      seasonPlayersRewritten: number
      futurePicks: number
      /** What the league plays by now: the provider's rules converted, the commissioner's AF edits kept, or defaults. */
      scoring: 'converted' | 'kept_af' | 'default'
      roster: 'mapped' | 'af_saved' | 'mlb'
      /** The provider's past weeks copied into native tables (Q4), or null when the league has no season to copy into. */
      pastScores: Omit<ProviderScoreCopy, 'matchupIds'> | null
    }
  | { kind: 'already_converted'; conversionId: string }

export async function convertImportedLeagueInPlace(
  prisma: PrismaClient,
  args: { leagueId: string; userId: string; acceptWeeklyLineups?: boolean; now?: Date },
): Promise<NativeConversionResult> {
  const teamCount = await prisma.leagueTeam.count({ where: { leagueId: args.leagueId } })
  const roster = await prepareNativeSettings(prisma, args)
  try {
    return await prisma.$transaction((tx) => convertInTransaction(tx, { ...args, roster }), {
      maxWait: 20_000,
      // The carryover's sizing (executeCanonicalLeagueCreation): two rows per team and then some.
      timeout: 60_000 + Math.max(0, teamCount - 32) * 1_500,
    })
  } catch (error) {
    if (error instanceof ImportedLeagueCarryoverError) throw new NativeConversionRefusal(error.message)
    throw error
  }
}

/**
 * The writes that cannot join the switch's transaction, run first and only for a league that would not be refused:
 * the roster layout (through the single roster writer, which owns its own connection), and the fill-only waiver and
 * draft-settings rows. Every one is idempotent and harmless on a league that is still imported, so a refusal later
 * leaves nothing that needs undoing.
 */
async function prepareNativeSettings(
  prisma: PrismaClient,
  args: { leagueId: string; userId: string; now?: Date },
): Promise<'mapped' | 'af_saved' | 'mlb' | 'none'> {
  const readiness = await checkNativeReadiness(prisma as unknown as Tx, args.leagueId, args.now ?? new Date())
  if (!readiness || readiness.status === 'native') return 'none'
  const blockers = readiness.items.filter((item) => item.severity === 'blocker')
  if (blockers.length) refuse(`${blockers.length} ${blockers.length === 1 ? 'thing needs' : 'things need'} fixing before this league can switch.`, blockers)

  const league = await prisma.league.findUnique({
    where: { id: args.leagueId },
    select: { sport: true, platform: true, leagueType: true, settings: true, taxiSlots: true, irSlots: true },
  })
  if (!league) refuse('League not found.')
  const layout = planImportedRosterLayout({ sport: String(league.sport), platform: String(league.platform), leagueType: league.leagueType, settings: league.settings, taxiSlots: league.taxiSlots, irSlots: league.irSlots })
  if (layout.kind === 'unreadable') refuse(`We can't read this league's roster spots. ${layout.reason}`)
  if (layout.kind === 'mapped') {
    try {
      await writeLeagueRosterConfig(args.leagueId, { templateKey: 'custom', slots: layout.slots }, { userId: args.userId, auditAction: 'import' })
    } catch (error) {
      refuse(`The roster spots could not be saved: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }
  await bootstrapLeagueWaiverSettings(args.leagueId)
  await ensureLeagueSettingsRow(args.leagueId)
  return layout.kind
}

async function convertInTransaction(
  tx: Tx,
  args: { leagueId: string; userId: string; acceptWeeklyLineups?: boolean; now?: Date; roster: 'mapped' | 'af_saved' | 'mlb' | 'none' },
): Promise<NativeConversionResult> {
  const { leagueId, userId } = args
  const now = args.now ?? new Date()

  // 1. Lock. A sync write-back landing mid-switch would put provider ids back into playerData.
  await tx.$queryRaw`SELECT "id" FROM "leagues" WHERE "id" = ${leagueId} FOR UPDATE`

  const existing = await tx.leagueNativeConversion.findUnique({ where: { leagueId }, select: { id: true, status: true } })
  if (existing?.status === 'applied') return { kind: 'already_converted', conversionId: existing.id }

  // 2. The same checks the commissioner saw, against the locked rows.
  const readiness = await checkNativeReadiness(tx, leagueId, now)
  if (!readiness) refuse('League not found.')
  if (readiness.status === 'native') refuse('This league already runs on AllFantasy.')
  const blockers = readiness.items.filter((item) => item.severity === 'blocker')
  if (blockers.length) refuse(`${blockers.length} ${blockers.length === 1 ? 'thing needs' : 'things need'} fixing before this league can switch.`, blockers)

  const league = await tx.league.findUnique({
    where: { id: leagueId },
    select: { userId: true, platform: true, platformLeagueId: true, season: true, sport: true, settings: true, syncStatus: true, playoffTeams: true, playoffStartWeek: true },
  })
  if (!league) refuse('League not found.')
  const sport = String(league.sport)

  // 3. Plan: the shared translation, with the copy flow's refusals.
  const read = await readImportedSource(tx, leagueId)
  const source = checkImportedSource(read.source, { sport, acceptWeeklyLineups: args.acceptWeeklyLineups })
  const teams = orderTeamsForSeats(read.teams, userId)
  const plan = await planImportedPlayerIdentity(tx, { sport, platform: String(league.platform), teams, rosters: read.rosters })
  const seats = assignNativeSeats(leagueId, teams, plan.sourceRosters)
  const rosterIdByExternalId = new Map(teams.map((team, i) => [team.externalId, seats[i]!.rosterId]))
  const teamIdByExternalId = new Map(teams.map((team) => [team.externalId, team.id]))

  // A provider id that happens to equal a native id would make the rename ambiguous. Two-phase renames below make the
  // unique keys safe; this makes the MAPPINGS safe.
  const nativeIds = new Set([...seats.map((s) => s.rosterId), ...teams.map((t) => t.id)])
  if (teams.some((t) => nativeIds.has(t.externalId))) refuse('A provider team id collides with an AllFantasy id. Contact support.')

  // 4. Snapshot everything the writes below change, before any of them run.
  const rosterRows = await tx.roster.findMany({
    where: { leagueId },
    select: { id: true, platformUserId: true, managerUserId: true, redraftRosterId: true, playerData: true, settings: true },
  })
  const teamRows = await tx.leagueTeam.findMany({
    where: { leagueId },
    select: {
      id: true, externalId: true, platformUserId: true, isOrphan: true, role: true,
      ownerName: true, teamName: true, avatarUrl: true, claimedByUserId: true, isCommissioner: true, isCoCommissioner: true,
    },
  })
  const season = await tx.redraftSeason.findFirst({ where: { leagueId }, orderBy: [{ season: 'desc' }, { createdAt: 'desc' }], select: { id: true, season: true, playoffStartWeek: true } })
  const redraftRosters = season
    ? await tx.redraftRoster.findMany({ where: { seasonId: season.id }, select: { id: true, ownerId: true, managerUserId: true, ownerName: true, teamName: true } })
    : []
  const redraftPlayers = redraftRosters.length
    ? await tx.redraftRosterPlayer.findMany({
        where: { rosterId: { in: redraftRosters.map((r) => r.id) }, droppedAt: null },
        select: { id: true, playerId: true, acquisitionType: true },
      })
    : []
  const futurePicks = await tx.futureDraftPick.findMany({ where: { leagueId }, select: { id: true, originalRosterId: true, currentOwnerId: true, status: true } })
  const draftSessions = await tx.draftSession.findMany({ where: { leagueId }, select: { id: true, sleeperDraftId: true, slotOrder: true } })
  const oldTeamKeys = [...teamIdByExternalId.keys()]
  const [matchupFacts, seasonStandingFacts, rosterSnapshots, seasonResults, leagueSeasons, entrySlotsBefore] = await Promise.all([
    tx.matchupFact.findMany({
      where: { leagueId, OR: [{ teamA: { in: oldTeamKeys } }, { teamB: { in: oldTeamKeys } }, { winnerTeamId: { in: oldTeamKeys } }] },
      select: { matchupId: true, teamA: true, teamB: true, winnerTeamId: true },
    }),
    tx.seasonStandingFact.findMany({ where: { leagueId, teamId: { in: oldTeamKeys } }, select: { standingId: true, teamId: true } }),
    tx.rosterSnapshot.findMany({ where: { leagueId, teamId: { in: oldTeamKeys } }, select: { snapshotId: true, teamId: true } }),
    tx.seasonResult.findMany({ where: { leagueId, rosterId: { in: oldTeamKeys } }, select: { id: true, rosterId: true } }),
    tx.leagueSeason.findMany({ where: { leagueId }, select: { id: true, teamRecords: true } }),
    tx.leagueEntrySlot.findMany({ where: { leagueId }, select: { id: true, rosterId: true, status: true } }),
  ])

  // 5. Rosters: two-phase on (leagueId, platformUserId), then the native key, translated players and open-seat flag.
  const rosterById = new Map(rosterRows.map((r) => [r.id, r]))
  for (const seat of seats) {
    await tx.roster.update({ where: { id: seat.rosterId }, data: { platformUserId: `tmp-conv-${seat.rosterId}` } })
  }
  for (const seat of seats) {
    const row = rosterById.get(seat.rosterId)!
    const translated = translateImportedRosterData(row.playerData, plan.idMap, leagueId)
    // The copy flow stamps `carriedOverFromLeagueId`; in place there is no other league to point at.
    const { carriedOverFromLeagueId: _copyOnly, ...foundation } = asRecord(translated.foundation)
    await tx.roster.update({
      where: { id: seat.rosterId },
      data: {
        platformUserId: seat.ownerKey,
        managerUserId: seat.managerUserId,
        playerData: {
          ...translated,
          foundation: { ...foundation, slotNumber: seat.slotNumber, openTeam: !seat.claimedUserId, convertedInPlace: true },
        } as Prisma.InputJsonValue,
        settings: { ...asRecord(row.settings), openSlot: !seat.claimedUserId } as Prisma.InputJsonValue,
      },
    })
  }

  // 6. Teams: two-phase on (leagueId, externalId) to `Roster.id`. Names, logos and the provider manager name stay (Q3).
  const teamById = new Map(teams.map((t) => [t.id, t]))
  for (const seat of seats) {
    await tx.leagueTeam.update({ where: { id: seat.teamId }, data: { externalId: `tmp-conv-${seat.teamId}` } })
  }
  for (const seat of seats) {
    const team = teamById.get(seat.teamId)!
    await tx.leagueTeam.update({
      where: { id: seat.teamId },
      data: {
        externalId: seat.rosterId,
        platformUserId: seat.ownerKey,
        isOrphan: !seat.claimedUserId,
        role: team.isCommissioner ? 'commissioner' : team.isCoCommissioner ? 'co_commissioner' : 'member',
      },
    })
  }

  // 7. The current redraft season: owner keys match the rosters' exactly (standingsEngine maps one onto the other), and
  //    carried players become ordinary drafted players (Q6) with native ids.
  let playersRewritten = 0
  /** Provider team id → this season's RedraftRoster.id, for the past-week copy (step 11c). */
  const redraftRosterIdByExternalId = new Map<string, string>()
  if (season) {
    const redraftByOwner = new Map(redraftRosters.map((r) => [r.ownerId, r]))
    const redraftById = new Map(redraftRosters.map((r) => [r.id, r]))
    const pairs: Array<{ seat: NativeSeat; redraftRosterId: string }> = []
    for (const seat of seats) {
      const row = rosterById.get(seat.rosterId)!
      const team = teamById.get(seat.teamId)!
      const linked = (row.redraftRosterId ? redraftById.get(row.redraftRosterId) : undefined)
        ?? redraftByOwner.get(row.platformUserId) ?? redraftByOwner.get(team.id)
      if (!linked) refuse(`The season standings have no row for ${team.teamName}. Refresh the import, then try again.`)
      pairs.push({ seat, redraftRosterId: linked.id })
      redraftRosterIdByExternalId.set(team.externalId, linked.id)
    }
    if (new Set(pairs.map((p) => p.redraftRosterId)).size !== pairs.length) refuse('Two teams share one season-standings row. Refresh the import, then try again.')
    for (const { redraftRosterId } of pairs) {
      await tx.redraftRoster.update({ where: { id: redraftRosterId }, data: { ownerId: `tmp-conv-${redraftRosterId}` } })
    }
    for (const { seat, redraftRosterId } of pairs) {
      await tx.redraftRoster.update({ where: { id: redraftRosterId }, data: { ownerId: seat.ownerKey, managerUserId: seat.managerUserId } })
      if (!rosterById.get(seat.rosterId)!.redraftRosterId) {
        await tx.roster.update({ where: { id: seat.rosterId }, data: { redraftRosterId } })
      }
    }
    const byProvider = new Map<string, string[]>()
    for (const row of redraftPlayers) {
      const nativeId = plan.idMap.get(row.playerId)
      if (!nativeId) refuse(`A rostered player (${row.playerId}) has no AllFantasy match. Refresh the import, then try again.`)
      if (nativeId !== row.playerId) byProvider.set(row.playerId, [...(byProvider.get(row.playerId) ?? []), row.id])
    }
    for (const [providerId, ids] of byProvider) {
      const written = await tx.redraftRosterPlayer.updateMany({ where: { id: { in: ids } }, data: { playerId: plan.idMap.get(providerId)! } })
      playersRewritten += written.count
    }
    await tx.redraftRosterPlayer.updateMany({
      where: { id: { in: redraftPlayers.map((r) => r.id) }, acquisitionType: 'imported' },
      data: { acquisitionType: 'drafted' },
    })
  }

  // 8. Future picks: EVERY row to `Roster.id`, not only traded ones (in place there is no fresh table to copy into).
  for (const pick of futurePicks) {
    const originalRosterId = rosterIdByExternalId.get(pick.originalRosterId)
    const currentOwnerId = rosterIdByExternalId.get(pick.currentOwnerId)
    if (!originalRosterId || !currentOwnerId) {
      if (pick.status === 'active') refuse('A future draft pick names a team we cannot find. Refresh the import, then try again.')
      continue
    }
    await tx.futureDraftPick.update({ where: { id: pick.id }, data: { originalRosterId, currentOwnerId } })
  }

  // 9. Drafts: nothing may mirror from the provider again (the Sleeper mirror selects on `sleeperDraftId` alone).
  for (const session of draftSessions) {
    await tx.draftSession.update({
      where: { id: session.id },
      data: { sleeperDraftId: null, slotOrder: remapSlotOrder(session.slotOrder, rosterIdByExternalId) as Prisma.InputJsonValue },
    })
  }

  // 10. History: team keys to `LeagueTeam.id`, roster keys to `Roster.id` — the copy flow's rule, applied in place.
  for (const [oldKey, teamId] of teamIdByExternalId) {
    await tx.matchupFact.updateMany({ where: { leagueId, teamA: oldKey }, data: { teamA: teamId } })
    await tx.matchupFact.updateMany({ where: { leagueId, teamB: oldKey }, data: { teamB: teamId } })
    await tx.matchupFact.updateMany({ where: { leagueId, winnerTeamId: oldKey }, data: { winnerTeamId: teamId } })
    await tx.seasonStandingFact.updateMany({ where: { leagueId, teamId: oldKey }, data: { teamId } })
    await tx.rosterSnapshot.updateMany({ where: { leagueId, teamId: oldKey }, data: { teamId } })
    await tx.seasonResult.updateMany({ where: { leagueId, rosterId: oldKey }, data: { rosterId: rosterIdByExternalId.get(oldKey)! } })
  }
  for (const row of leagueSeasons) {
    if (row.teamRecords == null) continue
    const next = remapTeamRecords(row.teamRecords, teamIdByExternalId, rosterIdByExternalId)
    if (JSON.stringify(next) !== JSON.stringify(row.teamRecords)) {
      await tx.leagueSeason.update({ where: { id: row.id }, data: { teamRecords: next as Prisma.InputJsonValue } })
    }
  }

  // 11. Membership the native engines read: one member row per manager, one entry slot per seat, a league chat room.
  const created: NativeConversionSnapshotV1['created'] = { memberIds: [], chatRoomIds: [], entrySlotIds: [] }
  const claimedUsers = new Map<string, number>()
  for (const seat of seats) if (seat.claimedUserId && !claimedUsers.has(seat.claimedUserId)) claimedUsers.set(seat.claimedUserId, seat.slotNumber)
  if (league.userId && !claimedUsers.has(league.userId)) claimedUsers.set(league.userId, 0)
  for (const [memberUserId, slotNumber] of claimedUsers) {
    const found = await tx.redraftLeagueMember.findUnique({ where: { leagueId_userId: { leagueId, userId: memberUserId } }, select: { id: true } })
    if (found) continue
    const team = seats.find((s) => s.claimedUserId === memberUserId)
    const isHead = memberUserId === league.userId || (team ? teamById.get(team.teamId)!.isCommissioner : false)
    const row = await tx.redraftLeagueMember.create({
      data: { leagueId, userId: memberUserId, role: isHead ? 'COMMISSIONER' : 'MEMBER', teamNumber: slotNumber || null },
      select: { id: true },
    })
    created.memberIds.push(row.id)
  }
  const slotsByNumber = new Map((await tx.leagueEntrySlot.findMany({ where: { leagueId }, select: { id: true, slotNumber: true } })).map((s) => [s.slotNumber, s.id]))
  for (const seat of seats) {
    const status = seat.claimedUserId ? 'FILLED' : 'OPEN'
    const existingSlot = slotsByNumber.get(seat.slotNumber)
    if (existingSlot) {
      await tx.leagueEntrySlot.update({ where: { id: existingSlot }, data: { rosterId: seat.rosterId, status } })
    } else {
      const row = await tx.leagueEntrySlot.create({ data: { id: randomUUID(), leagueId, slotNumber: seat.slotNumber, rosterId: seat.rosterId, status }, select: { id: true } })
      created.entrySlotIds.push(row.id)
    }
  }
  const room = await tx.redraftLeagueChatRoom.findFirst({ where: { leagueId, roomType: 'league' }, select: { id: true } })
  if (!room) {
    const row = await tx.redraftLeagueChatRoom.create({ data: { leagueId, roomType: 'league', title: 'League chat' }, select: { id: true } })
    created.chatRoomIds.push(row.id)
  }

  // 11b. Scoring the league actually plays by (Q8: a store the commissioner saved in AllFantasy wins), and the league's
  //      invite link. The roster layout was written before this transaction (prepareNativeSettings).
  const settings = asRecord(league.settings)
  const settingsPatch: Record<string, unknown> = {}
  let leagueColumns: Record<string, unknown> = {}
  let scoring: 'converted' | 'kept_af' | 'default' = savedInAllFantasy(sportScoringStore(settings, sport)) ? 'kept_af' : 'default'
  let mlbTablesBefore: NativeConversionSnapshotV1['mlbTablesBefore']
  if (scoring !== 'kept_af' && sport === 'NFL' && source.nflScoring) {
    Object.assign(settingsPatch, importedNflSettings(settings, source.nflScoring, userId))
    scoring = 'converted'
  }
  if (sport === 'MLB' && source.mlbScoring) {
    if (savedInAllFantasy(settings.mlb_scoring_config) || savedInAllFantasy(settings.mlb_roster_config)) {
      scoring = 'kept_af'
    } else {
      mlbTablesBefore = {
        rosterConfig: await tx.leagueRosterConfig.findUnique({ where: { leagueId } }),
        scoringOverrides: await tx.leagueScoringOverride.findMany({ where: { leagueId } }),
        scoringSnapshots: await tx.scoringSettingsSnapshot.findMany({
          where: { leagueId }, select: { id: true, scoringMode: true, scoringFormat: true, effectiveRules: true, overrides: true },
        }),
      }
      await writeImportedMlbScoringTables(tx, leagueId, source.mlbScoring, source.mlbRoster)
      Object.assign(settingsPatch, importedMlbSettings(settings, source.mlbScoring, source.mlbRoster, userId))
      leagueColumns = importedMlbLeagueColumns(source.mlbScoring)
      scoring = 'converted'
    }
  }
  for (const [key, value] of Object.entries(importedGamesPerWeekSettings(settings))) {
    if (settings[key] == null) settingsPatch[key] = value
  }
  const activeInvite = await tx.leagueInvite.findFirst({ where: { leagueId, isActive: true }, select: { id: true } })
  if (!activeInvite) {
    const invite = await tx.leagueInvite.create({
      data: { leagueId, createdBy: userId, createdByRole: 'commissioner', maxUses: inviteMaxUsesFor(seats.length) },
      select: { id: true },
    })
    created.inviteIds = [invite.id]
  }

  // 11c. The provider's past weeks into native tables (Q4), keyed by the provider league id the flip is about to replace.
  const playerScoresPreexisted = season
    ? (await tx.leaguePlayerWeeklyScore.count({ where: { leagueId, seasonYear: season.season, source: 'allfantasy' } })) > 0
    : false
  const pastScores = season
    ? await copyProviderWeeklyScores(tx, {
        leagueId,
        providerLeagueId: league.platformLeagueId,
        season: season.season,
        seasonId: season.id,
        playoffStartWeek: season.playoffStartWeek,
        sport,
        platform: String(league.platform),
        redraftRosterIdByExternalId,
        idMap: plan.idMap,
      })
    : null

  // 12. The record, then the flip — last, so nothing above ran on a league the engines already treat as native.
  const snapshot: NativeConversionSnapshotV1 = {
    version: 1,
    league: {
      platform: String(league.platform), platformLeagueId: league.platformLeagueId, syncStatus: league.syncStatus ?? null, settings: league.settings,
      columns: { playoffTeams: league.playoffTeams ?? null, playoffStartWeek: league.playoffStartWeek ?? null },
    },
    seasonAtSwitch: season ? { id: season.id, season: season.season } : null,
    teams: teamRows,
    rosters: rosterRows,
    redraftRosters,
    redraftPlayers,
    futurePicks: futurePicks.map(({ id, originalRosterId, currentOwnerId }) => ({ id, originalRosterId, currentOwnerId })),
    draftSessions,
    history: {
      matchupFacts: matchupFacts.map((r) => ({ id: r.matchupId, teamA: r.teamA, teamB: r.teamB, winnerTeamId: r.winnerTeamId })),
      seasonStandingFacts: seasonStandingFacts.map((r) => ({ id: r.standingId, teamId: r.teamId })),
      rosterSnapshots: rosterSnapshots.map((r) => ({ id: r.snapshotId, teamId: r.teamId })),
      seasonResults,
      leagueSeasons: leagueSeasons.filter((r) => r.teamRecords != null),
    },
    created,
    ...(mlbTablesBefore ? { mlbTablesBefore } : {}),
    ...(pastScores && season ? { copiedScores: { matchupIds: pastScores.matchupIds, playerScoresSeasonYear: season.season, playerScoresPreexisted } } : {}),
    entrySlotsBefore: entrySlotsBefore.map((s) => ({ id: s.id, rosterId: s.rosterId, status: String(s.status) })),
  }
  const record = {
    status: 'applied',
    fromPlatform: String(league.platform),
    fromPlatformLeagueId: league.platformLeagueId,
    fromSeason: league.season ?? now.getUTCFullYear(),
    convertedByUserId: userId,
    snapshot: snapshot as unknown as Prisma.InputJsonValue,
    snapshotVersion: 1,
    convertedAt: now,
    error: null,
  }
  const conversion = await tx.leagueNativeConversion.upsert({
    where: { leagueId }, create: { leagueId, ...record }, update: record, select: { id: true },
  })
  await tx.league.update({
    where: { id: leagueId },
    data: {
      platform: 'manual',
      platformLeagueId: `manual-${randomUUID()}`,
      syncStatus: 'manual',
      ...leagueColumns,
      settings: { ...settings, ...settingsPatch, nativeConversion: { conversionId: conversion.id, convertedAt: now.toISOString() } } as Prisma.InputJsonValue,
    },
  })

  return {
    kind: 'converted', conversionId: conversion.id, seats: seats.length, players: plan.idMap.size,
    seasonPlayersRewritten: playersRewritten, futurePicks: futurePicks.length, scoring,
    pastScores: pastScores ? (({ matchupIds: _ids, ...counts }) => counts)(pastScores) : null,
    roster: args.roster === 'none' ? 'af_saved' : args.roster,
  }
}
