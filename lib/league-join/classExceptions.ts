import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getLeagueRole } from '@/lib/league/permissions'
import { isAdminEmailAllowed, isAdminRole } from '@/lib/adminAuth'
import {
  readClassExceptions,
  readClassJoinRequests,
  withClassException,
  withClassJoinRequest,
  withoutClassException,
  withoutClassJoinRequest,
  type ClassBasis,
  type ClassRange,
} from '@/lib/league-join/managerClass'
import {
  resolveJoinRankGate,
  resolveLeagueClass,
  resolveUserRankLevel,
  skillClassOf,
} from '@/lib/league-join/resolveJoinRankGate'
import { readSkillBoard } from '@/lib/rank/skillRating/skillRatingStore'

/**
 * Commissioner exceptions to the ±2 manager-class band, and the requests that
 * lead to them. The rules are in `managerClass.ts`; this file reads and writes
 * them on `League.settings`.
 *
 * ⚠ EVERY WRITE TAKES THE LEAGUE ROW LOCK. Settings is one JSON column that many
 * routes read-modify-write; two concurrent requests could otherwise each read the
 * list, append, and the second write would drop the first.
 */

export type SessionUserLike = { id?: string | null; role?: string | null; email?: string | null }

/** Head commissioner, co-commissioner, or a platform admin. Members may not grant exceptions. */
export async function canManageClassExceptions(leagueId: string, user: SessionUserLike): Promise<boolean> {
  if (!user.id) return false
  if (isAdminRole(user.role) || isAdminEmailAllowed(user.email)) return true
  const role = await getLeagueRole(leagueId, user.id)
  return role === 'commissioner' || role === 'co_commissioner'
}

async function updateSettingsLocked(
  leagueId: string,
  mutate: (settings: unknown) => Record<string, unknown> | null,
): Promise<boolean> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const league = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    if (!league) return false
    const next = mutate(league.settings)
    if (!next) return true
    await tx.league.update({ where: { id: leagueId }, data: { settings: next as Prisma.InputJsonValue } })
    return true
  })
}

async function levelOf(userId: string): Promise<number> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { xpLevel: true, legacyCareerLevel: true },
  })
  return resolveUserRankLevel(profile)
}

async function commissionerIds(leagueId: string): Promise<string[]> {
  const [league, teams] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } }),
    prisma.leagueTeam.findMany({
      where: { leagueId, claimedByUserId: { not: null }, OR: [{ isCommissioner: true }, { isCoCommissioner: true }] },
      select: { claimedByUserId: true },
    }),
  ])
  const ids = new Set<string>()
  if (league?.userId) ids.add(league.userId)
  for (const t of teams) if (t.claimedByUserId) ids.add(t.claimedByUserId)
  return [...ids]
}

async function notify(params: {
  userIds: string[]
  leagueId: string
  type: string
  title: string
  body: string
  actionHref: string
  actionLabel: string
}) {
  if (params.userIds.length === 0) return
  try {
    const { dispatchNotification } = await import('@/lib/notifications/NotificationDispatcher')
    await dispatchNotification({
      userIds: params.userIds,
      category: 'commissioner_alerts',
      type: params.type,
      title: params.title,
      body: params.body,
      actionHref: params.actionHref,
      actionLabel: params.actionLabel,
      leagueId: params.leagueId,
      severity: 'medium',
    })
  } catch (e) {
    // A failed notification must never undo the request or decision it reports.
    console.warn('[manager-class] notification failed', e instanceof Error ? e.message : e)
  }
}

async function displayNames(userIds: string[]): Promise<Map<string, { username: string | null; displayName: string | null }>> {
  if (userIds.length === 0) return new Map()
  const users = await prisma.appUser.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true, displayName: true },
  })
  return new Map(users.map((u) => [u.id, { username: u.username ?? null, displayName: u.displayName ?? null }]))
}

/* ─────────────────────────────── manager side ─────────────────────────────── */

export type RequestExceptionResult =
  | { ok: true; status: 'requested' | 'already_requested' | 'not_needed' | 'already_granted' }
  | { ok: false; status: 404; error: string }

/**
 * A blocked manager asks the commissioner to let them in. Only recorded when the
 * gate actually blocks them — a manager inside the band just joins.
 */
export async function requestClassException(input: { leagueId: string; userId: string }): Promise<RequestExceptionResult> {
  const league = await prisma.league.findUnique({ where: { id: input.leagueId }, select: { id: true, name: true, settings: true } })
  if (!league) return { ok: false, status: 404, error: 'League not found' }

  const gate = await resolveJoinRankGate({ leagueId: input.leagueId, userId: input.userId })
  if (gate.allowed) return { ok: true, status: gate.reason === 'COMMISSIONER_EXCEPTION' ? 'already_granted' : 'not_needed' }

  if (readClassJoinRequests(league.settings).some((r) => r.userId === input.userId)) {
    return { ok: true, status: 'already_requested' }
  }

  await updateSettingsLocked(input.leagueId, (settings) =>
    withClassJoinRequest(settings, { userId: input.userId, levelAtRequest: gate.userRankLevel }),
  )

  const names = await displayNames([input.userId])
  const who = names.get(input.userId)
  const handle = who?.username ? `@${who.username}` : who?.displayName ?? 'A manager'
  await notify({
    userIds: await commissionerIds(input.leagueId),
    leagueId: input.leagueId,
    type: 'manager_class_request',
    title: `${handle} asked to join ${league.name ?? 'your league'}`,
    body:
      gate.basis === 'skill'
        ? `${handle} is ${gate.sport ?? ''} skill Class ${gate.userClass}; your league plays at Class ${gate.minRankLevel}–${gate.maxRankLevel}. Approve or decline in league settings.`
        : `${handle} is Level ${gate.userRankLevel}; your league is for Level ${gate.minRankLevel}–${gate.maxRankLevel}. Approve or decline in league settings.`,
    actionHref: `/league/${input.leagueId}/settings`,
    actionLabel: 'Review request',
  })

  return { ok: true, status: 'requested' }
}

/* ───────────────────────────── commissioner side ──────────────────────────── */

export type ClassGateSummary = {
  range: ClassRange | null
  /** `skill` once any member is rated in the league's sport; `level` until then. */
  basis: ClassBasis
  sport: string | null
  /** Members whose skill set the class (0 on the level basis). */
  ratedMembers: number
  exceptions: Array<{
    userId: string
    username: string | null
    displayName: string | null
    level: number
    /** Skill class in the league's sport; null while unrated. */
    skillClass: number | null
    grantedAt: string
    via: 'direct' | 'request'
  }>
  requests: Array<{
    userId: string
    username: string | null
    displayName: string | null
    level: number
    skillClass: number | null
    requestedAt: string
  }>
}

export async function getClassGateSummary(leagueId: string): Promise<ClassGateSummary | null> {
  const [league, board] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }),
    readSkillBoard().catch(() => null),
  ])
  if (!league) return null
  const leagueClass = await resolveLeagueClass(leagueId, board)

  const exceptions = readClassExceptions(league.settings)
  const requests = readClassJoinRequests(league.settings)
  const ids = [...new Set([...exceptions.map((e) => e.userId), ...requests.map((r) => r.userId)])]
  const [names, profiles] = await Promise.all([
    displayNames(ids),
    ids.length
      ? prisma.userProfile.findMany({ where: { userId: { in: ids } }, select: { userId: true, xpLevel: true, legacyCareerLevel: true } })
      : Promise.resolve([]),
  ])
  const levels = new Map(profiles.map((p) => [p.userId, resolveUserRankLevel(p)]))
  const skillOf = (id: string) => skillClassOf(board, leagueClass.sport, id)

  return {
    range: leagueClass.range,
    basis: leagueClass.basis,
    sport: leagueClass.sport,
    ratedMembers: leagueClass.ratedMembers,
    exceptions: exceptions.map((e) => ({
      userId: e.userId,
      username: names.get(e.userId)?.username ?? null,
      displayName: names.get(e.userId)?.displayName ?? null,
      level: levels.get(e.userId) ?? 1,
      skillClass: skillOf(e.userId),
      grantedAt: e.grantedAt,
      via: e.via,
    })),
    requests: requests.map((r) => ({
      userId: r.userId,
      username: names.get(r.userId)?.username ?? null,
      displayName: names.get(r.userId)?.displayName ?? null,
      level: levels.get(r.userId) ?? 1,
      skillClass: skillOf(r.userId),
      requestedAt: r.requestedAt,
    })),
  }
}

export type ClassDecision = 'grant' | 'approve' | 'decline' | 'revoke'

export type ClassDecisionResult = { ok: true; summary: ClassGateSummary | null } | { ok: false; status: 400 | 404; error: string }

/**
 * A commissioner's decision. `grant` names a manager directly (by user id or
 * username); `approve` / `decline` answer a pending request; `revoke` removes an
 * exception. Revoking does not remove a manager who has already joined — the
 * band is checked at the door, not afterwards.
 */
export async function decideClassException(input: {
  leagueId: string
  decidedBy: string
  action: ClassDecision
  userId?: string | null
  username?: string | null
}): Promise<ClassDecisionResult> {
  let targetId = input.userId?.trim() || null
  if (!targetId && input.username?.trim()) {
    const handle = input.username.trim().replace(/^@/, '')
    const user = await prisma.appUser.findFirst({
      where: { username: { equals: handle, mode: 'insensitive' } },
      select: { id: true },
    })
    if (!user) return { ok: false, status: 404, error: `No AllFantasy user is named ${handle}.` }
    targetId = user.id
  }
  if (!targetId) return { ok: false, status: 400, error: 'Name the manager by username.' }

  const league = await prisma.league.findUnique({ where: { id: input.leagueId }, select: { name: true, settings: true } })
  if (!league) return { ok: false, status: 404, error: 'League not found' }

  if ((input.action === 'approve' || input.action === 'decline') &&
      !readClassJoinRequests(league.settings).some((r) => r.userId === targetId)) {
    return { ok: false, status: 404, error: 'That manager has no pending request.' }
  }

  const level = await levelOf(targetId)
  const target = targetId
  await updateSettingsLocked(input.leagueId, (settings) => {
    switch (input.action) {
      case 'grant':
        return withClassException(settings, { userId: target, grantedBy: input.decidedBy, via: 'direct', levelAtGrant: level })
      case 'approve':
        return withClassException(settings, { userId: target, grantedBy: input.decidedBy, via: 'request', levelAtGrant: level })
      case 'decline':
        return withoutClassJoinRequest(settings, target)
      case 'revoke':
        return withoutClassException(settings, target)
    }
  })

  if (input.action === 'approve' || input.action === 'decline' || input.action === 'grant') {
    const name = league.name ?? 'the league'
    const approved = input.action !== 'decline'
    await notify({
      userIds: [target],
      leagueId: input.leagueId,
      type: approved ? 'manager_class_approved' : 'manager_class_declined',
      title: approved ? `You can join ${name}` : `The commissioner of ${name} declined your request`,
      body: approved
        ? 'The commissioner made an exception to the league’s level range for you. Use your invite link to take your seat.'
        : 'This league stays with its level range. Find a league built for your level in League finder.',
      actionHref: approved ? `/league/${input.leagueId}` : '/find-league',
      actionLabel: approved ? 'Open league' : 'Find a league',
    })
  }

  return { ok: true, summary: await getClassGateSummary(input.leagueId) }
}
