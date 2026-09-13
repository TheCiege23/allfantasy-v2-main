import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { requireCommissionerOnly } from '@/lib/league/permissions'
import { getZombieRulesForSport } from '@/lib/zombie/zombieRules'
import { resolveWhispererViewer } from '@/lib/zombie/whispererViewer'

export const dynamic = 'force-dynamic'

/**
 * Full inventory context for the Items screen (private; commissioner can pass userId).
 */
export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const leagueId = searchParams?.get('leagueId')
  const userIdParam = searchParams?.get('userId')
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, session.user.id)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const z = await prisma.zombieLeague.findUnique({ where: { leagueId } })
  if (!z) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let targetUserId = session.user.id
  if (userIdParam && userIdParam !== session.user.id) {
    await requireCommissionerOnly(leagueId, session.user.id)
    targetUserId = userIdParam
  }

  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: targetUserId },
  })
  if (!roster) {
    return NextResponse.json({
      items: [],
      rules: await getZombieRulesForSport(z.sport),
      history: [],
      resolution: null,
      isCommissionerView: targetUserId !== session.user.id,
      pendingBashingDecision: null,
    })
  }

  const team = await prisma.zombieLeagueTeam.findUnique({
    where: { leagueId_rosterId: { leagueId, rosterId: roster.id } },
    include: { items: { orderBy: { acquiredAt: 'desc' } } },
  })

  const week = Math.max(1, z.currentWeek || 1)
  const resolution = await prisma.zombieWeeklyResolution.findUnique({
    where: { zombieLeagueId_week: { zombieLeagueId: z.id, week } },
    select: { status: true, resolvedAt: true },
  })

  const history = await prisma.zombieChimmyAction.findMany({
    where: {
      leagueId,
      userId: targetUserId,
    },
    orderBy: { createdAt: 'desc' },
    take: 40,
    select: {
      id: true,
      actionType: true,
      week: true,
      isValid: true,
      rawMessage: true,
      createdAt: true,
      publicResponse: true,
    },
  })

  const whisperer = await prisma.whispererRecord.findUnique({
    where: { zombieLeagueId: z.id },
    select: { userId: true, ambushesRemaining: true },
  })

  const viewer = await resolveWhispererViewer(leagueId, session.user.id)

  const now = new Date()
  const pendingBash = await prisma.zombieBashingEvent.findFirst({
    where: {
      leagueId,
      winnerUserId: targetUserId,
      requiresDecision: true,
      decisionMade: null,
      OR: [{ decisionDeadline: null }, { decisionDeadline: { gt: now } }],
    },
    orderBy: { createdAt: 'desc' },
  })

  let pendingBashingDecision: {
    id: string
    week: number
    loserName: string
    margin: number
    hoursLeft?: number
    deadlineIso: string | null
  } | null = null
  if (pendingBash) {
    const loserRoster = await prisma.roster.findFirst({
      where: { leagueId, platformUserId: pendingBash.loserUserId },
      select: { id: true },
    })
    let loserName = pendingBash.loserUserId
    if (loserRoster) {
      const zt = await prisma.zombieLeagueTeam.findUnique({
        where: { leagueId_rosterId: { leagueId, rosterId: loserRoster.id } },
        select: { fantasyTeamName: true, displayName: true },
      })
      loserName = zt?.fantasyTeamName || zt?.displayName || loserName
    }
    const dl = pendingBash.decisionDeadline
    const hoursLeft =
      dl && dl > now ? Math.round(((dl.getTime() - now.getTime()) / 3_600_000) * 10) / 10 : undefined
    pendingBashingDecision = {
      id: pendingBash.id,
      week: pendingBash.week,
      loserName,
      margin: pendingBash.margin,
      ...(hoursLeft !== undefined ? { hoursLeft } : {}),
      deadlineIso: dl?.toISOString() ?? null,
    }
  }

  return NextResponse.json({
    items: team?.items ?? [],
    teamStatus: team?.status ?? 'Survivor',
    rules: await getZombieRulesForSport(z.sport),
    history,
    resolution,
    // Only a viewer allowed to know the Whisperer learns who it is.
    whispererUserId: viewer.canSee ? (whisperer?.userId ?? null) : null,
    isWhisperer: whisperer?.userId === targetUserId,
    ambushesRemaining: whisperer?.userId === targetUserId ? whisperer.ambushesRemaining : null,
    isCommissionerView: targetUserId !== session.user.id,
    isPaid: z.isPaid,
    week,
    pendingBashingDecision,
  })
}

