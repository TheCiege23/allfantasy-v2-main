import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildSeasonBlueprint, type SeasonBlueprint, type BlueprintStaffRole } from './seasonBlueprint'
import { can } from './tournamentPermissions'
import { verifySeasonCalendar, seasonContractHash } from './seasonCalendarVerification'

const CONFIG_ACTIONS = ['season_blueprint_created', 'season_blueprint_updated']


export class BlueprintOperationError extends Error {
  constructor(message: string, public readonly status: 403 | 404 | 409) {
    super(message)
    this.name = 'BlueprintOperationError'
  }
}

function shellFields(config: SeasonBlueprint) {
  const plan = buildSeasonBlueprint(config)
  return {
    name: config.name, sport: config.sport, maxParticipants: config.participants,
    conferenceCount: 1, leaguesPerConference: plan.stages[0]!.leagueCount,
    teamsPerLeague: Math.max(...plan.stages[0]!.sizes),
    namingMode: 'commissioner_custom', openingWeekStart: config.startWeek,
    redraftWeek: config.firstCutWeek + 1, eliteRedraftWeek: config.secondCutWeek + 1,
    championshipWeek: config.finalWeek, totalRounds: 3, scoringSystem: config.scoring,
    draftType: config.draftType, openingRosterSize: config.rosterSize,
    tournamentRosterSize: config.rosterSize, eliteRosterSize: config.rosterSize,
    tradeEnabled: config.trades, bubbleEnabled: false,
  }
}

function latestConfig(tx: Prisma.TransactionClient, tournamentId: string) {
  return tx.tournamentAuditLog.findFirst({
    where: { tournamentId, action: { in: CONFIG_ACTIONS } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
}

/**
 * Serialize blueprint edits and grant changes on the shell row.
 * The conditional write rejects concurrent writers. Permissions are rechecked AFTER
 * acquiring this lock, so a just-revoked editor cannot save with stale authority.
 */
async function lockBlueprint(tx: Prisma.TransactionClient, tournamentId: string, userId: string, ownerOnly: boolean, allowPublished = false) {
  const shell = await tx.tournamentShell.findUnique({ where: { id: tournamentId } })
  if (!shell) throw new BlueprintOperationError('Tournament plan not found.', 404)
  if (ownerOnly && shell.commissionerId !== userId) throw new BlueprintOperationError('Only the owner can manage tournament staff.', 403)
  if (shell.status !== 'blueprint' && !(allowPublished && shell.status === 'rules_published')) throw new BlueprintOperationError('Rules can only be edited while this tournament is a plan.', 409)
  const updatedAt = new Date(Math.max(Date.now(), shell.updatedAt.getTime() + 1))
  const lock = await tx.tournamentShell.updateMany({
    where: { id: tournamentId, status: shell.status, updatedAt: shell.updatedAt },
    data: { updatedAt },
  })
  if (lock.count !== 1) throw new BlueprintOperationError('The tournament changed. Reload the latest plan before trying again.', 409)
  if (shell.commissionerId !== userId) {
    const grant = await tx.tournamentShellGrant.findUnique({ where: { tournamentId_userId: { tournamentId, userId } } })
    if (!can({ userId, commissionerId: shell.commissionerId, grant }, 'editSettings')) {
      throw new BlueprintOperationError('You have read-only access to this plan.', 403)
    }
  }
  return { shell, updatedAt }
}

export async function saveSeasonBlueprint(userId: string, input: unknown) {
  const plan = buildSeasonBlueprint(input)
  return prisma.$transaction(async tx => {
    const shell = await tx.tournamentShell.create({ data: {
      ...shellFields(plan.config), status: 'blueprint', commissionerId: userId, createdBy: userId,
    } })
    await tx.tournamentAuditLog.create({ data: {
      tournamentId: shell.id, action: 'season_blueprint_created', actorType: 'commissioner',
      actorId: userId, targetType: 'tournament', targetId: shell.id, data: plan.config,
    } })
    return shell.id
  })
}

export async function updateSeasonBlueprint(userId: string, tournamentId: string, revision: string, input: unknown) {
  const plan = buildSeasonBlueprint(input)
  return prisma.$transaction(async tx => {
    const { updatedAt } = await lockBlueprint(tx, tournamentId, userId, false)
    const current = await latestConfig(tx, tournamentId)
    if (!current || current.id !== revision) {
      throw new BlueprintOperationError('Someone saved newer rules. Reload the latest plan before saving your changes.', 409)
    }
    const timestamp = new Date(Math.max(updatedAt.getTime(), current.createdAt.getTime() + 1))
    await tx.tournamentShell.update({ where: { id: tournamentId }, data: { ...shellFields(plan.config), updatedAt: timestamp } })
    const event = await tx.tournamentAuditLog.create({ data: {
      tournamentId, action: 'season_blueprint_updated', actorType: 'commissioner', actorId: userId,
      targetType: 'tournament', targetId: tournamentId, data: plan.config, createdAt: timestamp,
    } })
    return { tournamentId, revision: event.id }
  })
}

export async function setBlueprintStaff(userId: string, tournamentId: string, username: string, role: BlueprintStaffRole) {
  return prisma.$transaction(async tx => {
    const { shell } = await lockBlueprint(tx, tournamentId, userId, true, true)
    const assignee = await tx.appUser.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } }, select: { id: true },
    })
    if (!assignee) throw new BlueprintOperationError('AllFantasy username not found.', 404)
    if (assignee.id === shell.commissionerId) throw new BlueprintOperationError('The owner already has full access.', 409)
    // Planning roles deliberately do not grant live broadcast, advancement or delegation.
    const permissions = { role, canEditSettings: role === 'co_commissioner', canBroadcast: false, canAdvance: false }
    await tx.tournamentShellGrant.upsert({
      where: { tournamentId_userId: { tournamentId, userId: assignee.id } },
      create: { tournamentId, userId: assignee.id, grantedByUserId: userId, ...permissions },
      update: { ...permissions, grantedByUserId: userId },
    })
    await tx.tournamentAuditLog.create({ data: {
      tournamentId, action: 'blueprint_staff_assigned', actorType: 'commissioner', actorId: userId,
      targetType: 'user', targetId: assignee.id, data: permissions,
    } })
  })
}

export async function removeBlueprintStaff(userId: string, tournamentId: string, assigneeId: string) {
  return prisma.$transaction(async tx => {
    const { shell } = await lockBlueprint(tx, tournamentId, userId, true, true)
    if (assigneeId === shell.commissionerId) throw new BlueprintOperationError('The tournament owner cannot be removed.', 409)
    const result = await tx.tournamentShellGrant.deleteMany({ where: { tournamentId, userId: assigneeId } })
    if (result.count > 0) await tx.tournamentAuditLog.create({ data: {
      tournamentId, action: 'blueprint_staff_removed', actorType: 'commissioner', actorId: userId,
      targetType: 'user', targetId: assigneeId, data: {},
    } })
  })
}

export async function loadSeasonBlueprint(tournamentId: string, userId: string) {
  const shell = await prisma.tournamentShell.findUnique({ where: { id: tournamentId } })
  if (!shell || !['blueprint', 'rules_published'].includes(shell.status)) return null
  const isOwner = shell.commissionerId === userId
  const grant = isOwner ? null : await prisma.tournamentShellGrant.findUnique({
    where: { tournamentId_userId: { tournamentId, userId } },
  })
  if (!isOwner && !grant) return null
  const publication = shell.status === 'rules_published' ? await prisma.tournamentAuditLog.findFirst({ where: { tournamentId, action: 'season_rules_published' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }) : null
  const row = await latestConfig(prisma, tournamentId)
  if (!row) return null
  const grants = isOwner ? await prisma.tournamentShellGrant.findMany({ where: { tournamentId }, orderBy: { createdAt: 'asc' } }) : []
  const users = grants.length ? await prisma.appUser.findMany({
    where: { id: { in: grants.map(g => g.userId) } }, select: { id: true, username: true, displayName: true },
  }) : []
  const byId = new Map(users.map(u => [u.id, u]))
  const published = publication?.data as { config: unknown; hash: string; sourceRevision: string; calendar: { digest: string; checkedAt: string; regularGames: number; pendingGames: number; excludedGames: unknown[] } } | undefined
  if (shell.status === 'rules_published' && !published) return null
  return {
    ...buildSeasonBlueprint(published?.config ?? row.data), tournamentId, revision: publication?.id ?? row.id, isOwner,
    ...(publication && published ? { publication: { id: publication.id, hash: published.hash, sourceRevision: published.sourceRevision, calendarDigest: published.calendar.digest, publishedAt: publication.createdAt.toISOString(), checkedAt: published.calendar.checkedAt, regularGames: published.calendar.regularGames, pendingGames: published.calendar.pendingGames, excludedGames: published.calendar.excludedGames.length } } : {}),
    canEditSettings: shell.status === 'blueprint' && can({ userId, commissionerId: shell.commissionerId, grant }, 'editSettings'),
    staff: grants.map(g => ({
      userId: g.userId, username: byId.get(g.userId)?.username ?? '',
      displayName: byId.get(g.userId)?.displayName || byId.get(g.userId)?.username || 'Unavailable account',
      role: g.canEditSettings ? 'co_commissioner' as const : 'viewer' as const,
    })),
  }
}


/** Read permission is checked before spending a provider request. No client-supplied schedule is trusted. */
export async function checkBlueprintCalendar(userId: string, tournamentId: string, revision: string) {
  const plan = await loadSeasonBlueprint(tournamentId, userId)
  if (!plan) throw new BlueprintOperationError('Tournament plan not found.', 404)
  if (!plan.canEditSettings) throw new BlueprintOperationError('Only planning editors can verify this calendar.', 403)
  if (plan.revision !== revision) throw new BlueprintOperationError('The rules changed. Reload the latest plan.', 409)
  try { return await verifySeasonCalendar(plan.config) }
  catch (e) { throw new BlueprintOperationError(e instanceof Error ? e.message : 'Calendar verification unavailable.', 409) }
}

export async function publishSeasonRules(userId: string, tournamentId: string, revision: string, digest: string, acceptExcludedGames: boolean, acceptPendingGames: boolean) {
  const plan = await loadSeasonBlueprint(tournamentId, userId)
  if (!plan || !plan.isOwner) throw new BlueprintOperationError('Only the tournament owner can publish rules.', 403)
  if (plan.publication) {
    if (plan.publication.id === revision || (plan.publication.sourceRevision === revision && plan.publication.calendarDigest === digest)) return { tournamentId, publicationId: plan.publication.id, hash: plan.publication.hash }
    throw new BlueprintOperationError('The tournament rules have already been published.', 409)
  }
  if (plan.revision !== revision) throw new BlueprintOperationError('The rules changed. Reload the latest plan.', 409)
  const calendar = await checkBlueprintCalendar(userId, tournamentId, revision)
  if (calendar.digest !== digest) throw new BlueprintOperationError('The provider schedule changed. Check and review the calendar again.', 409)
  if (!calendar.ready) throw new BlueprintOperationError('Calendar has unresolved blockers: ' + calendar.blockers.join(' '), 409)
  if (calendar.excludedGames.length && !acceptExcludedGames) throw new BlueprintOperationError('Acknowledge games excluded by scoring gaps before publication.', 409)
  if (calendar.pendingGames && !acceptPendingGames) throw new BlueprintOperationError('Acknowledge pending NBA Cup-dependent games before publication.', 409)
  const openingDraft = plan.config.rules!.calendar.drafts.find(d => d.stage === 1)!
  if (Date.parse(openingDraft.startsAt) <= Date.now()) throw new BlueprintOperationError('The opening draft is already in the past. Update the calendar before publication.', 409)
  const hash = seasonContractHash({ config: plan.config, calendarDigest: calendar.digest, acceptExcludedGames, acceptPendingGames })
  return prisma.$transaction(async tx => {
    const { updatedAt } = await lockBlueprint(tx, tournamentId, userId, true)
    const current = await latestConfig(tx, tournamentId)
    if (!current || current.id !== revision) throw new BlueprintOperationError('The rules changed during publication. Reload the latest plan.', 409)
    const event = await tx.tournamentAuditLog.create({ data: {
      tournamentId, action: 'season_rules_published', actorType: 'commissioner', actorId: userId,
      targetType: 'tournament', targetId: tournamentId,
      data: { version: 1, sourceRevision: revision, config: plan.config, hash, calendar, acceptExcludedGames, acceptPendingGames },
      createdAt: new Date(Math.max(updatedAt.getTime(), current.createdAt.getTime() + 1)),
    } })
    await tx.tournamentShell.update({ where: { id: tournamentId }, data: { status: 'rules_published', updatedAt } })
    return { tournamentId, publicationId: event.id, hash }
  })
}
