import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuditLogs } from '@/server/services/auditService'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export type LeagueInspectSnapshot = {
  league: {
    id: string
    name: string | null
    sport: string
    season: number
    platform: string
    platformLeagueId: string
    lifecycleState: string | null
    locked: boolean
    emergencyPaused: boolean
    status: string | null
    leagueVariant: string | null
    userId: string
    createdAt: Date
    updatedAt: Date
  } | null
  draftSession: Record<string, unknown> | null
  waiverRunsRecent: Array<{
    id: string
    runAt: Date
    status: string
    runType: string
  }>
  rosterCount: number
  finance: Record<string, unknown> | null
  duesSummary: { paid: number; pending: number; waived: number }
  leagueAuditTail: Awaited<ReturnType<typeof getAuditLogs>>['items']
  financeAuditTail: Array<{
    id: string
    eventType: string
    entityType: string
    createdAt: Date
    actorUserId: string | null
  }>
  notificationsBacklog: { unreadApprox: number }
}

export async function buildLeagueInspectSnapshot(leagueId: string): Promise<LeagueInspectSnapshot | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      name: true,
      sport: true,
      season: true,
      platform: true,
      platformLeagueId: true,
      lifecycleState: true,
      locked: true,
      emergencyPaused: true,
      status: true,
      leagueVariant: true,
      userId: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  if (!league) return null

  const [draftSession, waiverRunsRecent, rosterCount, finance, duesAgg, leagueAuditTail, financeAuditTail, unreadNotes] =
    await Promise.all([
      prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER }),
      prisma.waiverRun.findMany({
        where: { leagueId },
        orderBy: { runAt: 'desc' },
        take: 8,
        select: { id: true, runAt: true, status: true, runType: true },
      }),
      prisma.roster.count({ where: { leagueId } }),
      prisma.leagueFinance.findUnique({ where: { leagueId } }),
      prisma.leagueDues.groupBy({
        by: ['status'],
        where: { leagueId },
        _count: { _all: true },
      }),
      getAuditLogs(leagueId, { limit: 40 }).then((r) => r.items),
      prisma.financeAuditEvent.findMany({
        where: { leagueId },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: { id: true, eventType: true, entityType: true, createdAt: true, actorUserId: true },
      }),
      prisma.platformNotification.count({
        where: { leagueId, readAt: null },
      }),
    ])

  const duesSummary = { paid: 0, pending: 0, waived: 0 }
  for (const row of duesAgg) {
    const c = row._count._all
    if (row.status === 'paid') duesSummary.paid = c
    else if (row.status === 'pending') duesSummary.pending = c
    else if (row.status === 'waived') duesSummary.waived = c
  }

  return {
    league,
    draftSession: draftSession ? (draftSession as unknown as Record<string, unknown>) : null,
    waiverRunsRecent,
    rosterCount,
    finance: finance ? (finance as unknown as Record<string, unknown>) : null,
    duesSummary,
    leagueAuditTail,
    financeAuditTail,
    notificationsBacklog: { unreadApprox: unreadNotes },
  }
}

export async function searchLeaguesForAdmin(params: {
  q: string
  limit?: number
}): Promise<
  Array<{
    id: string
    name: string | null
    sport: string
    season: number
    platform: string
    lifecycleState: string | null
    updatedAt: Date
  }>
> {
  const raw = params.q.trim()
  if (!raw) return []
  const limit = Math.min(params.limit ?? 20, 50)
  const or: Prisma.LeagueWhereInput[] = [
    { name: { contains: raw, mode: 'insensitive' } },
    { platformLeagueId: { contains: raw, mode: 'insensitive' } },
  ]
  if (raw.length >= 8 && /^[a-z0-9]+$/i.test(raw)) {
    or.push({ id: raw })
  }

  return prisma.league.findMany({
    where: { OR: or },
    take: limit,
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      sport: true,
      season: true,
      platform: true,
      lifecycleState: true,
      updatedAt: true,
    },
  })
}
