import { createHash } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import type { NativeConversionSnapshotV1 } from '@/lib/league/convertImportedLeagueInPlace'

/**
 * Undo an in-place switch to AllFantasy: put the league back to running from its provider, exactly as it was the
 * moment it switched. docs/league-import/IN_PLACE_NATIVE_CONVERSION_PLAN.md §8, step 6 of §14.
 *
 * THE WINDOW (Q10, decided 2026-11-26): open until the league's first native season starts, EVEN AFTER native
 * activity. "Starts" is read as: the league has a season newer than the one it switched in (a renewal or a new-season
 * rollover created it). After that the new season's rows are keyed to AllFantasy ids the provider has never seen, and
 * undo is refused for good (`undoClosedAt` is stamped the first time anyone asks).
 *
 * WHAT IT DISCARDS. Everything the league did on AllFantasy since the switch: trades, waiver claims and pickups,
 * roster moves, keeper picks, a draft set up or run, managers who joined through an invite link. `previewNativeUndo`
 * counts each one so the commissioner sees the list first, and `undoNativeConversion` refuses unless it is handed the
 * token of the list they saw: if anything happened in between, they are shown the new list instead.
 *
 * WHAT IT RESTORES, from the snapshot (`NativeConversionSnapshotV1`): the league's platform, provider id, sync status
 * and settings; every roster's owner key and players; every team's provider key, owner and flags; the season's owner
 * keys and players; pick owners; mirrored drafts; history keys; entry slots; and, for baseball, the scoring tables.
 *
 * WHAT IT LEAVES, on purpose: the chat (never changed), the waiver and draft-settings rows and the saved roster layout
 * the switch filled in before its transaction (an imported league reads its provider's positions first, so they are
 * inert), and the `LeagueNativeConversion` row, which becomes `undone` and keeps its snapshot as the record. Once it
 * is not `applied`, re-importing the provider league is allowed again (nativeConversionLookup.ts).
 *
 * One transaction, the league row locked, the flip back LAST — the switch's own shape, reversed.
 */

type Tx = Prisma.TransactionClient

export class NativeUndoRefusal extends Error {
  constructor(message: string, readonly code: 'none' | 'closed' | 'changed' | 'conflict', readonly preview?: NativeUndoPreview) {
    super(message)
  }
}

export type NativeUndoDiscard = { code: string; label: string; count: number }

export type NativeUndoPreview =
  | { status: 'none' }
  | { status: 'closed'; conversionId: string; reason: string }
  | {
      status: 'open'
      conversionId: string
      convertedAt: string
      fromPlatform: string
      /** Only what actually happened (count > 0). Empty means undo throws nothing away. */
      discards: NativeUndoDiscard[]
      /** Hand back to `undoNativeConversion`: it refuses if the list has changed since. */
      token: string
    }

export type NativeUndoResult = { kind: 'undone'; conversionId: string; discarded: NativeUndoDiscard[]; notRestored: string[] }

const PLATFORM_NAMES: Record<string, string> = {
  sleeper: 'Sleeper', espn: 'ESPN', yahoo: 'Yahoo', mfl: 'MyFantasyLeague', fantrax: 'Fantrax', fleaflicker: 'Fleaflicker',
}
export function providerName(platform: string): string {
  return PLATFORM_NAMES[platform.toLowerCase()] ?? platform
}

type Conversion = {
  id: string; status: string; fromSeason: number; convertedAt: Date | null; undoClosedAt: Date | null
  fromPlatform: string; snapshot: unknown; snapshotVersion: number
}

function readSnapshot(conversion: Conversion): NativeConversionSnapshotV1 | null {
  const snap = conversion.snapshot as NativeConversionSnapshotV1 | null
  return conversion.snapshotVersion === 1 && snap?.version === 1 && Array.isArray(snap.rosters) ? snap : null
}

/** Why undo is closed, or null while it is open. Stamps `undoClosedAt` the first time a season is found to have started. */
async function windowClosedReason(tx: Tx, leagueId: string, conversion: Conversion, snap: NativeConversionSnapshotV1, now: Date): Promise<string | null> {
  if (conversion.undoClosedAt) return 'Undo closed when the league started its first season on AllFantasy.'
  const switchedSeason = snap.seasonAtSwitch?.season ?? conversion.fromSeason
  const newer = await tx.redraftSeason.findFirst({ where: { leagueId, season: { gt: switchedSeason } }, select: { season: true } })
  if (newer) {
    await tx.leagueNativeConversion.update({ where: { id: conversion.id }, data: { undoClosedAt: now } })
    return `Undo closed when the league started its ${newer.season} season on AllFantasy.`
  }
  const [rosterIds, teamIds] = await Promise.all([
    tx.roster.findMany({ where: { leagueId }, select: { id: true } }),
    tx.leagueTeam.findMany({ where: { leagueId }, select: { id: true } }),
  ])
  if (!sameIds(rosterIds.map((r) => r.id), snap.rosters.map((r) => r.id)) || !sameIds(teamIds.map((t) => t.id), snap.teams.map((t) => t.id))) {
    return 'Teams were added or removed since the switch, so the league can no longer go back to how it was.'
  }
  const clash = await tx.league.findFirst({
    where: { id: { not: leagueId }, platform: snap.league.platform, platformLeagueId: snap.league.platformLeagueId },
    select: { id: true },
  })
  if (clash) return `Another copy of this ${providerName(snap.league.platform)} league was imported since the switch. Delete it first, then undo.`
  return null
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')
}

/** Everything the league did on AllFantasy since the switch, which undo throws away. */
async function countDiscards(tx: Tx, leagueId: string, since: Date, snap: NativeConversionSnapshotV1): Promise<NativeUndoDiscard[]> {
  const redraftIds = snap.redraftRosters.map((r) => r.id)
  const snapshotMemberIds = snap.created.memberIds
  const [trades, claims, pickups, adds, drops, keepers, drafts, joined, picks] = await Promise.all([
    tx.afLeagueTrade.count({ where: { leagueId, createdAt: { gt: since } } }),
    tx.waiverClaim.count({ where: { leagueId, createdAt: { gt: since } } }),
    tx.waiverTransaction.count({ where: { leagueId, processedAt: { gt: since } } }),
    redraftIds.length ? tx.redraftRosterPlayer.count({ where: { rosterId: { in: redraftIds }, addedAt: { gt: since } } }) : 0,
    redraftIds.length ? tx.redraftRosterPlayer.count({ where: { rosterId: { in: redraftIds }, droppedAt: { gt: since } } }) : 0,
    tx.keeperDeclaration.count({ where: { leagueId, createdAt: { gt: since } } }),
    tx.draftSession.count({ where: { leagueId, createdAt: { gt: since } } }),
    tx.redraftLeagueMember.count({ where: { leagueId, joinedAt: { gt: since }, id: { notIn: snapshotMemberIds } } }),
    tx.futureDraftPick.count({ where: { leagueId, createdAt: { gt: since } } }),
  ])
  const all: NativeUndoDiscard[] = [
    { code: 'trades', label: plural(trades, 'trade', 'trades') + ' proposed or made on AllFantasy', count: trades },
    { code: 'waiver_claims', label: plural(claims, 'waiver claim', 'waiver claims'), count: claims },
    { code: 'pickups', label: plural(pickups, 'waiver or free-agent pickup', 'waiver or free-agent pickups'), count: pickups },
    { code: 'players_added', label: plural(adds, 'player added to a roster', 'players added to rosters'), count: adds },
    { code: 'players_dropped', label: plural(drops, 'player dropped', 'players dropped'), count: drops },
    { code: 'keepers', label: plural(keepers, 'keeper pick', 'keeper picks'), count: keepers },
    { code: 'drafts', label: plural(drafts, 'draft set up on AllFantasy', 'drafts set up on AllFantasy'), count: drafts },
    { code: 'picks', label: plural(picks, 'new future draft pick', 'new future draft picks'), count: picks },
    { code: 'joined', label: plural(joined, 'manager who joined through an invite link loses their team', 'managers who joined through invite links lose their teams'), count: joined },
  ]
  return all.filter((d) => d.count > 0)
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function tokenFor(conversionId: string, discards: NativeUndoDiscard[]): string {
  return createHash('sha256').update(JSON.stringify([conversionId, discards.map((d) => [d.code, d.count])])).digest('hex').slice(0, 32)
}

async function loadConversion(tx: Tx, leagueId: string): Promise<Conversion | null> {
  return tx.leagueNativeConversion.findUnique({
    where: { leagueId },
    select: { id: true, status: true, fromSeason: true, convertedAt: true, undoClosedAt: true, fromPlatform: true, snapshot: true, snapshotVersion: true },
  })
}

async function previewIn(tx: Tx, leagueId: string, now: Date): Promise<{ preview: NativeUndoPreview; conversion?: Conversion; snap?: NativeConversionSnapshotV1 }> {
  const conversion = await loadConversion(tx, leagueId)
  if (!conversion || conversion.status !== 'applied' || !conversion.convertedAt) return { preview: { status: 'none' } }
  const snap = readSnapshot(conversion)
  if (!snap) return { preview: { status: 'closed', conversionId: conversion.id, reason: 'This switch was recorded in a format undo cannot read. Contact support.' } }
  const reason = await windowClosedReason(tx, leagueId, conversion, snap, now)
  if (reason) return { preview: { status: 'closed', conversionId: conversion.id, reason } }
  const discards = await countDiscards(tx, leagueId, conversion.convertedAt, snap)
  return {
    preview: {
      status: 'open', conversionId: conversion.id, convertedAt: conversion.convertedAt.toISOString(),
      fromPlatform: conversion.fromPlatform, discards, token: tokenFor(conversion.id, discards),
    },
    conversion, snap,
  }
}

/** What undo would do right now: closed and why, or open with the list of what it throws away. Read-only. */
export async function previewNativeUndo(db: PrismaClient | Tx, leagueId: string, now = new Date()): Promise<NativeUndoPreview> {
  return (await previewIn(db as Tx, leagueId, now)).preview
}

export async function undoNativeConversion(
  prisma: PrismaClient,
  args: { leagueId: string; userId: string; token: string; now?: Date },
): Promise<NativeUndoResult> {
  const snapRosters = await prisma.roster.count({ where: { leagueId: args.leagueId } })
  return prisma.$transaction((tx) => undoInTransaction(tx, args), {
    maxWait: 20_000,
    timeout: 60_000 + Math.max(0, snapRosters - 32) * 1_500,
  })
}

const json = (value: unknown) => (value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue))

async function undoInTransaction(tx: Tx, args: { leagueId: string; userId: string; token: string; now?: Date }): Promise<NativeUndoResult> {
  const { leagueId } = args
  const now = args.now ?? new Date()

  // 1. Lock, then decide against the locked state: a trade accepted a second ago is on the list or the token fails.
  await tx.$queryRaw`SELECT "id" FROM "leagues" WHERE "id" = ${leagueId} FOR UPDATE`
  const { preview, conversion, snap } = await previewIn(tx, leagueId, now)
  if (preview.status === 'none') throw new NativeUndoRefusal('This league has no switch to undo.', 'none', preview)
  if (preview.status === 'closed') throw new NativeUndoRefusal(preview.reason, 'closed', preview)
  if (preview.token !== args.token) {
    throw new NativeUndoRefusal('Something changed in the league since you looked. Check the list again before undoing.', 'changed', preview)
  }
  const since = conversion!.convertedAt!
  const s = snap!
  const notRestored: string[] = []

  // 2. Throw away what the league did on AllFantasy since the switch (the list the commissioner confirmed).
  const redraftIds = s.redraftRosters.map((r) => r.id)
  const snapshotPlayerIds = s.redraftPlayers.map((p) => p.id)
  await tx.afLeagueTrade.deleteMany({ where: { leagueId, createdAt: { gt: since } } })
  await tx.waiverClaim.deleteMany({ where: { leagueId, createdAt: { gt: since } } })
  await tx.waiverTransaction.deleteMany({ where: { leagueId, processedAt: { gt: since } } })
  await tx.keeperDeclaration.deleteMany({ where: { leagueId, createdAt: { gt: since } } })
  await tx.draftSession.deleteMany({ where: { leagueId, createdAt: { gt: since } } })
  await tx.futureDraftPick.deleteMany({ where: { leagueId, createdAt: { gt: since }, id: { notIn: s.futurePicks.map((p) => p.id) } } })
  if (redraftIds.length) {
    await tx.redraftRosterPlayer.deleteMany({ where: { rosterId: { in: redraftIds }, addedAt: { gt: since }, id: { notIn: snapshotPlayerIds } } })
  }
  // The switch's own rows, and anything the same kind made since (an invite link, a member who joined, a slot).
  await tx.leagueInvite.deleteMany({ where: { leagueId, OR: [{ id: { in: s.created.inviteIds ?? [] } }, { createdAt: { gt: since } }] } })
  await tx.redraftLeagueMember.deleteMany({ where: { leagueId, OR: [{ id: { in: s.created.memberIds } }, { joinedAt: { gt: since } }] } })
  await tx.leagueEntrySlot.deleteMany({
    where: { leagueId, OR: [{ id: { in: s.created.entrySlotIds } }, { createdAt: { gt: since } }], id: { notIn: s.entrySlotsBefore.map((e) => e.id) } },
  })
  if (s.copiedScores) {
    if (s.copiedScores.matchupIds.length) await tx.redraftMatchup.deleteMany({ where: { id: { in: s.copiedScores.matchupIds } } })
    if (s.copiedScores.playerScoresPreexisted === undefined) {
      notRestored.push('AllFantasy copies of past player points were kept: this switch did not record whether some were there before it.')
    } else if (!s.copiedScores.playerScoresPreexisted) {
      await tx.leaguePlayerWeeklyScore.deleteMany({ where: { leagueId, seasonYear: s.copiedScores.playerScoresSeasonYear, source: 'allfantasy' } })
    }
  }

  // 3. Rosters: two-phase on (leagueId, platformUserId), then exactly the snapshot.
  for (const r of s.rosters) await tx.roster.update({ where: { id: r.id }, data: { platformUserId: `tmp-undo-${r.id}` } })
  for (const r of s.rosters) {
    await tx.roster.update({
      where: { id: r.id },
      data: {
        platformUserId: r.platformUserId, managerUserId: r.managerUserId, redraftRosterId: r.redraftRosterId,
        playerData: r.playerData as Prisma.InputJsonValue, settings: json(r.settings),
      },
    })
  }

  // 4. Teams: two-phase on (leagueId, externalId), then the provider key and everything a seat claim overwrites.
  for (const t of s.teams) await tx.leagueTeam.update({ where: { id: t.id }, data: { externalId: `tmp-undo-${t.id}` } })
  let teamsWithoutOwner = 0
  for (const t of s.teams) {
    const claimFields = t.ownerName !== undefined
      ? {
          ownerName: t.ownerName ?? '', teamName: t.teamName ?? '', avatarUrl: t.avatarUrl ?? null, claimedByUserId: t.claimedByUserId ?? null,
          isCommissioner: t.isCommissioner ?? false, isCoCommissioner: t.isCoCommissioner ?? false,
        }
      : (teamsWithoutOwner++, {})
    await tx.leagueTeam.update({
      where: { id: t.id },
      data: { externalId: t.externalId, platformUserId: t.platformUserId, isOrphan: t.isOrphan, role: t.role, ...claimFields },
    })
  }
  if (teamsWithoutOwner) notRestored.push('Team names and owners were left as they are now: this switch did not record them.')

  // 5. The season: two-phase on (seasonId, ownerId), then the provider keys; players back to what was carried.
  for (const r of s.redraftRosters) await tx.redraftRoster.update({ where: { id: r.id }, data: { ownerId: `tmp-undo-${r.id}` } })
  for (const r of s.redraftRosters) {
    await tx.redraftRoster.update({
      where: { id: r.id },
      data: {
        ownerId: r.ownerId, managerUserId: r.managerUserId,
        ...(r.ownerName !== undefined ? { ownerName: r.ownerName ?? '' } : {}),
        ...(r.teamName !== undefined ? { teamName: r.teamName } : {}),
      },
    })
  }
  let playersMissing = 0
  for (const p of s.redraftPlayers) {
    const done = await tx.redraftRosterPlayer.updateMany({ where: { id: p.id }, data: { playerId: p.playerId, acquisitionType: p.acquisitionType, droppedAt: null } })
    if (done.count !== 1) playersMissing++
  }
  if (playersMissing) notRestored.push(`${playersMissing} rostered ${playersMissing === 1 ? 'player was' : 'players were'} removed since the switch; the next ${providerName(s.league.platform)} sync brings rosters back.`)

  // 6. Picks, drafts, history, entry slots.
  for (const p of s.futurePicks) {
    await tx.futureDraftPick.updateMany({ where: { id: p.id }, data: { originalRosterId: p.originalRosterId, currentOwnerId: p.currentOwnerId } })
  }
  for (const d of s.draftSessions) {
    await tx.draftSession.updateMany({ where: { id: d.id }, data: { sleeperDraftId: d.sleeperDraftId, slotOrder: (d.slotOrder ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull } })
  }
  for (const f of s.history.matchupFacts) {
    await tx.matchupFact.updateMany({ where: { matchupId: f.id }, data: { teamA: f.teamA, teamB: f.teamB, winnerTeamId: f.winnerTeamId } })
  }
  for (const f of s.history.seasonStandingFacts) await tx.seasonStandingFact.updateMany({ where: { standingId: f.id }, data: { teamId: f.teamId } })
  for (const f of s.history.rosterSnapshots) await tx.rosterSnapshot.updateMany({ where: { snapshotId: f.id }, data: { teamId: f.teamId } })
  for (const f of s.history.seasonResults) await tx.seasonResult.updateMany({ where: { id: f.id }, data: { rosterId: f.rosterId } })
  for (const f of s.history.leagueSeasons) await tx.leagueSeason.updateMany({ where: { id: f.id }, data: { teamRecords: json(f.teamRecords) } })
  for (const e of s.entrySlotsBefore) {
    await tx.leagueEntrySlot.updateMany({ where: { id: e.id }, data: { rosterId: e.rosterId, status: e.status as never } })
  }

  // 7. Baseball: the scoring tables the converter replaced.
  if (s.mlbTablesBefore) {
    const before = s.mlbTablesBefore.rosterConfig as { templateId?: string; overrides?: unknown } | null
    if (before?.templateId) {
      await tx.leagueRosterConfig.upsert({
        where: { leagueId },
        create: { leagueId, templateId: before.templateId, overrides: json(before.overrides) },
        update: { templateId: before.templateId, overrides: json(before.overrides) },
      })
    } else {
      await tx.leagueRosterConfig.deleteMany({ where: { leagueId } })
    }
    await tx.leagueScoringOverride.deleteMany({ where: { leagueId } })
    const overrides = (s.mlbTablesBefore.scoringOverrides as Array<{ statKey: string; pointsValue: number; enabled: boolean }>)
    if (overrides.length) {
      await tx.leagueScoringOverride.createMany({ data: overrides.map((o) => ({ leagueId, statKey: o.statKey, pointsValue: o.pointsValue, enabled: o.enabled })) })
    }
    if (s.mlbTablesBefore.scoringSnapshots) {
      for (const row of s.mlbTablesBefore.scoringSnapshots) {
        await tx.scoringSettingsSnapshot.updateMany({
          where: { id: row.id },
          data: { scoringMode: row.scoringMode, scoringFormat: row.scoringFormat, effectiveRules: row.effectiveRules as Prisma.InputJsonValue, overrides: json(row.overrides) },
        })
      }
    } else {
      notRestored.push('The scoring snapshots were left as converted: this switch did not record them.')
    }
  }

  // 8. The record, then the flip back — last.
  await tx.leagueNativeConversion.update({
    where: { id: conversion!.id },
    data: { status: 'undone', undoneAt: now, undoneByUserId: args.userId },
  })
  await tx.league.update({
    where: { id: leagueId },
    data: {
      platform: s.league.platform,
      platformLeagueId: s.league.platformLeagueId,
      syncStatus: s.league.syncStatus,
      settings: json(s.league.settings),
      ...(s.league.columns ? { playoffTeams: s.league.columns.playoffTeams, playoffStartWeek: s.league.columns.playoffStartWeek } : {}),
    },
  })

  return { kind: 'undone', conversionId: conversion!.id, discarded: preview.discards, notRestored }
}
