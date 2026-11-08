import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getLeagueRole } from '@/lib/league/permissions'
import { isAdminEmailAllowed, isAdminRole } from '@/lib/adminAuth'
import { loadCareerLedger, type CareerLedgerRow } from '@/lib/rank/careerLedger'
import { careerXp } from '@/lib/rank/careerXp'
import {
  hasClassException,
  readClassExceptions,
  readClassJoinRequests,
  withClassException,
  withClassJoinRequest,
  withoutClassException,
  withoutClassJoinRequest,
} from '@/lib/class-rating/exceptions'
import { decideCareerJoin, evaluateCareerJoinGate, leagueCareerLevel, loadCareerXpLevels } from './careerJoinGate'

/** Commissioner review for an out-of-band Career Level join. Existing grants remain scoped to one manager. */
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
    if (!next) return false
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

const handleOf = (n: { username: string | null; displayName: string | null } | undefined) =>
  n?.username ? `@${n.username}` : n?.displayName ?? 'A manager'

/* ─────────────────────────────── manager side ─────────────────────────────── */

export type RequestExceptionResult =
  | { ok: true; status: 'requested' | 'already_requested' | 'not_needed' | 'already_granted' }
  | { ok: false; status: 404; error: string }

/** A manager the gate refused asks the commissioner to let them in. */
export async function requestClassException(input: { leagueId: string; userId: string }): Promise<RequestExceptionResult> {
  const league = await prisma.league.findUnique({ where: { id: input.leagueId }, select: { id: true, name: true, userId: true, settings: true } })
  if (!league) return { ok: false, status: 404, error: 'League not found' }
  if (hasClassException(league.settings, input.userId)) return { ok: true, status: 'already_granted' }

  const gate = await evaluateCareerJoinGate(input.userId, input.leagueId, league)
  if (!gate || gate.canJoin) return { ok: true, status: 'not_needed' }
  if (readClassJoinRequests(league.settings).some((r) => r.userId === input.userId)) return { ok: true, status: 'already_requested' }

  let alreadyGranted = false
  const saved = await updateSettingsLocked(input.leagueId, (settings) => {
    alreadyGranted = hasClassException(settings, input.userId)
    if (alreadyGranted || readClassJoinRequests(settings).some((r) => r.userId === input.userId)) return null
    return withClassJoinRequest(settings, { userId: input.userId, divisionAtRequest: null })
  })
  if (!saved) return { ok: true, status: alreadyGranted ? 'already_granted' : 'already_requested' }

  const [names, history, recipients] = await Promise.all([
    displayNames([input.userId]).catch(() => new Map()),
    loadCareerLedger([input.userId]).catch(() => []),
    commissionerIds(input.leagueId).catch(() => []),
  ])
  const handle = handleOf(names.get(input.userId))
  const summary = summarizeHistory(history)
  const [lo, hi] = gate.band
  await notify({
    userIds: recipients,
    leagueId: input.leagueId,
    type: 'class_join_request',
    title: `${handle} asked to join ${league.name ?? 'your league'}`,
    body: `${handle} is Career Level ${gate.userLevel}. This league allows direct joins from levels ${lo}–${hi}. ${summary} Review the request in league settings.`,
    actionHref: `/league/${input.leagueId}/settings`,
    actionLabel: 'Review request',
  })
  return { ok: true, status: 'requested' }
}

/* ───────────────────────────── commissioner side ──────────────────────────── */

function summarizeHistory(rows: CareerLedgerRow[]): string {
  const results = rows.filter((r) => r.gamesPlayed > 0 || r.survival != null || r.wonChampionship)
  if (!results.length) return 'No verified results on file.'
  const xp = careerXp(results)
  const ties = results.reduce((sum, row) => sum + row.ties, 0)
  return `${xp.distinctSeasons} season ${xp.distinctSeasons === 1 ? 'year' : 'years'} · ${xp.leagueSeasons} league-${xp.leagueSeasons === 1 ? 'season' : 'seasons'} · ${xp.wins}–${xp.losses}–${ties} (W–L–T) · ${xp.championships} ${xp.championships === 1 ? 'title' : 'titles'}`
}

type Person = {
  userId: string
  username: string | null
  displayName: string | null
  careerLevel: number
  history: string
}

export type ClassGateSummary = {
  leagueLevel: number
  band: [number, number]
  exceptions: Array<Person & { grantedAt: string; via: 'direct' | 'request' }>
  requests: Array<Person & { requestedAt: string }>
}

export async function getClassGateSummary(leagueId: string): Promise<ClassGateSummary | null> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, settings: true } })
  if (!league) return null
  const exceptions = readClassExceptions(league.settings)
  const requests = readClassJoinRequests(league.settings)
  const ids = [...new Set([...exceptions.map((e) => e.userId), ...requests.map((r) => r.userId)])]
  const [names, levels, rows] = await Promise.all([
    displayNames(ids),
    loadCareerXpLevels([league.userId, ...ids]),
    loadCareerLedger(requests.map((r) => r.userId)).catch(() => []),
  ])
  const byUser = new Map<string, CareerLedgerRow[]>()
  for (const row of rows) {
    const history = byUser.get(row.userId) ?? []
    history.push(row)
    byUser.set(row.userId, history)
  }
  const person = (userId: string): Person => ({
    userId,
    username: names.get(userId)?.username ?? null,
    displayName: names.get(userId)?.displayName ?? null,
    careerLevel: levels.get(userId) ?? 1,
    history: summarizeHistory(byUser.get(userId) ?? []),
  })
  const leagueLevel = leagueCareerLevel(league, levels)
  return {
    leagueLevel,
    band: decideCareerJoin(leagueLevel, leagueLevel).band,
    exceptions: exceptions.map((e) => ({ ...person(e.userId), grantedAt: e.grantedAt, via: e.via })),
    requests: requests.map((r) => ({ ...person(r.userId), requestedAt: r.requestedAt })),
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

  const target = targetId
  const changed = await updateSettingsLocked(input.leagueId, (settings) => {
    if ((input.action === 'approve' || input.action === 'decline') && !readClassJoinRequests(settings).some((r) => r.userId === target)) return null
    switch (input.action) {
      case 'grant':
        return withClassException(settings, { userId: target, grantedBy: input.decidedBy, via: 'direct', divisionAtGrant: null })
      case 'approve':
        return withClassException(settings, { userId: target, grantedBy: input.decidedBy, via: 'request', divisionAtGrant: null })
      case 'decline':
        return withoutClassJoinRequest(settings, target)
      case 'revoke':
        return withoutClassException(settings, target)
    }
  })

  if (!changed) return { ok: false, status: 404, error: 'That manager has no pending request.' }

  if (input.action !== 'revoke') {
    const name = league.name ?? 'the league'
    const approved = input.action !== 'decline'
    const code = (league.settings as { inviteCode?: string } | null)?.inviteCode
    await notify({
      userIds: [target],
      leagueId: input.leagueId,
      type: approved ? 'class_join_approved' : 'class_join_declined',
      title: approved ? `You can join ${name}` : `The commissioner of ${name} declined your request`,
      body: approved
        ? 'The commissioner approved your Career Level exception. Use your invite to join.'
        : 'You can look for another league with an opening in Find a League.',
      actionHref: approved && code ? `/join?code=${encodeURIComponent(code)}` : '/find-league',
      actionLabel: approved && code ? 'Join league' : 'Find a league',
    })
  }

  return { ok: true, summary: await getClassGateSummary(input.leagueId) }
}
