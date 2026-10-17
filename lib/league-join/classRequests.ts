import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getLeagueRole } from '@/lib/league/permissions'
import { isAdminEmailAllowed, isAdminRole } from '@/lib/adminAuth'
import { divisionBand, getLeagueDivision } from '@/lib/class-rating/divisionGate'
import {
  hasClassException,
  readClassExceptions,
  readClassJoinRequests,
  withClassException,
  withClassJoinRequest,
  withoutClassException,
  withoutClassJoinRequest,
} from '@/lib/class-rating/exceptions'
import { getManagerClass, type ManagerClass } from '@/lib/class-rating/reads'
import { evaluateJoinDivisionGate, isOpenLeague } from '@/lib/league-join/joinDivisionGate'

/**
 * "Ask the commissioner" — the request and decision flow around the division gate (ADR F2.10a rule 6).
 * Ported from PR #1753's `classExceptions.ts` onto the division gate (owner ruling, 2026-10-01).
 *
 *   manager   refused an OPEN join → asks → commissioners are notified
 *   commish   approves (or names a manager directly) → that ONE manager is excepted
 *   manager   joins again → the gate treats them as invited: allowed and flagged
 *
 * ⚠ EVERY WRITE TAKES THE LEAGUE ROW LOCK. Settings is one JSON column that many routes
 * read-modify-write; two concurrent requests would otherwise each read the list, append, and the
 * second write would drop the first.
 *
 * ⚠ A REQUEST IS RECORDED ONLY WHEN THE GATE WOULD REFUSE. A manager inside the band, unrated or
 * provisional, or already excepted just joins — queuing them would hand the commissioner a decision
 * that is not theirs to make.
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
    console.warn('[class-requests] notification failed', e instanceof Error ? e.message : e)
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

const divisionOf = (c: ManagerClass) => (c.status === 'established' ? c.division : null)
const handleOf = (n: { username: string | null; displayName: string | null } | undefined) =>
  n?.username ? `@${n.username}` : n?.displayName ?? 'A manager'

/* ─────────────────────────────── manager side ─────────────────────────────── */

export type RequestExceptionResult =
  | { ok: true; status: 'requested' | 'already_requested' | 'not_needed' | 'already_granted' }
  | { ok: false; status: 404; error: string }

/** A manager the gate refused asks the commissioner to let them in. */
export async function requestClassException(input: { leagueId: string; userId: string }): Promise<RequestExceptionResult> {
  const league = await prisma.league.findUnique({ where: { id: input.leagueId }, select: { id: true, name: true, settings: true } })
  if (!league) return { ok: false, status: 404, error: 'League not found' }
  if (hasClassException(league.settings, input.userId)) return { ok: true, status: 'already_granted' }

  const gate = await evaluateJoinDivisionGate({ userId: input.userId, leagueId: input.leagueId, credential: { kind: 'league_code' } })
  if (gate.outcome !== 'deny') return { ok: true, status: 'not_needed' }
  if (readClassJoinRequests(league.settings).some((r) => r.userId === input.userId)) return { ok: true, status: 'already_requested' }

  await updateSettingsLocked(input.leagueId, (settings) =>
    withClassJoinRequest(settings, { userId: input.userId, divisionAtRequest: gate.userDivision }),
  )

  const handle = handleOf((await displayNames([input.userId])).get(input.userId))
  const [lo, hi] = gate.band
  await notify({
    userIds: await commissionerIds(input.leagueId),
    leagueId: input.leagueId,
    type: 'class_join_request',
    title: `${handle} asked to join ${league.name ?? 'your league'}`,
    body: `${handle} is in Division ${gate.userDivision}; your league plays in Division ${gate.leagueDivision}, so open joins are for Divisions ${lo}–${hi}. Approve or decline in league settings.`,
    actionHref: `/league/${input.leagueId}/settings`,
    actionLabel: 'Review request',
  })
  return { ok: true, status: 'requested' }
}

/* ───────────────────────────── commissioner side ──────────────────────────── */

type Person = {
  userId: string
  username: string | null
  displayName: string | null
  /** Current Class standing; the division is null while unrated or provisional. */
  classLevel: number | null
  division: number | null
  provisional: boolean
}

export type ClassGateSummary = {
  /** The league's division (median of its established members); null while it has none. */
  division: number | null
  /** Divisions an open join is allowed from. Null while the league is unrated. */
  band: [number, number] | null
  /**
   * Whether the gate applies at all: only a league that publishes its join code (public, public
   * dashboard, orphan-seeking) refuses anyone. In a private league every join is an invitation.
   */
  open: boolean
  exceptions: Array<Person & { grantedAt: string; via: 'direct' | 'request'; divisionAtGrant: number | null }>
  requests: Array<Person & { requestedAt: string; divisionAtRequest: number | null }>
}

async function people(ids: string[]): Promise<Map<string, Person>> {
  const [names, classes] = await Promise.all([displayNames(ids), Promise.all(ids.map((id) => getManagerClass(id)))])
  return new Map(
    ids.map((id, i) => {
      const c = classes[i]
      return [
        id,
        {
          userId: id,
          username: names.get(id)?.username ?? null,
          displayName: names.get(id)?.displayName ?? null,
          classLevel: c.status === 'established' ? c.classLevel : null,
          division: divisionOf(c),
          provisional: c.status === 'provisional',
        },
      ]
    }),
  )
}

export async function getClassGateSummary(leagueId: string): Promise<ClassGateSummary | null> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  if (!league) return null
  const division = await getLeagueDivision(leagueId)
  const exceptions = readClassExceptions(league.settings)
  const requests = readClassJoinRequests(league.settings)
  const byId = await people([...new Set([...exceptions.map((e) => e.userId), ...requests.map((r) => r.userId)])])
  return {
    division,
    band: division == null ? null : divisionBand(division),
    open: isOpenLeague(league.settings),
    exceptions: exceptions.map((e) => ({ ...byId.get(e.userId)!, grantedAt: e.grantedAt, via: e.via, divisionAtGrant: e.divisionAtGrant })),
    requests: requests.map((r) => ({ ...byId.get(r.userId)!, requestedAt: r.requestedAt, divisionAtRequest: r.divisionAtRequest })),
  }
}

export type ClassDecision = 'grant' | 'approve' | 'decline' | 'revoke'

export type ClassDecisionResult = { ok: true; summary: ClassGateSummary | null } | { ok: false; status: 400 | 404; error: string }

/**
 * A commissioner's decision. `grant` names a manager directly (by user id or username); `approve` /
 * `decline` answer a pending request; `revoke` withdraws an exception. Revoking does not remove a
 * manager who already joined — the gate is checked at the door, not afterwards.
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

  if (
    (input.action === 'approve' || input.action === 'decline') &&
    !readClassJoinRequests(league.settings).some((r) => r.userId === targetId)
  ) {
    return { ok: false, status: 404, error: 'That manager has no pending request.' }
  }

  const division = divisionOf(await getManagerClass(targetId))
  const target = targetId
  await updateSettingsLocked(input.leagueId, (settings) => {
    switch (input.action) {
      case 'grant':
        return withClassException(settings, { userId: target, grantedBy: input.decidedBy, via: 'direct', divisionAtGrant: division })
      case 'approve':
        return withClassException(settings, { userId: target, grantedBy: input.decidedBy, via: 'request', divisionAtGrant: division })
      case 'decline':
        return withoutClassJoinRequest(settings, target)
      case 'revoke':
        return withoutClassException(settings, target)
    }
  })

  if (input.action !== 'revoke') {
    const name = league.name ?? 'the league'
    const approved = input.action !== 'decline'
    await notify({
      userIds: [target],
      leagueId: input.leagueId,
      type: approved ? 'class_join_approved' : 'class_join_declined',
      title: approved ? `You can join ${name}` : `The commissioner of ${name} declined your request`,
      body: approved
        ? 'The commissioner let you in from outside the league’s division. Use your invite link to take your seat.'
        : 'This league stays with its division. Find a league in your division in League finder.',
      actionHref: approved ? `/league/${input.leagueId}` : '/find-league',
      actionLabel: approved ? 'Open league' : 'Find a league',
    })
  }

  return { ok: true, summary: await getClassGateSummary(input.leagueId) }
}
