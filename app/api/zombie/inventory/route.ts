import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { requireCommissionerOnly } from '@/lib/league/permissions'
import { getZombieRulesForSport } from '@/lib/zombie/zombieRules'
import { getZombieLeagueConfig } from '@/lib/zombie/ZombieLeagueConfig'
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
  const [resolvedRules, leagueConfig] = await Promise.all([
    getZombieRulesForSport(z.sport),
    getZombieLeagueConfig(leagueId),
  ])
  const rules = { ...resolvedRules, reviveThreshold: z.sport.toUpperCase() === 'NFL' ? 2 : leagueConfig?.serumReviveCount ?? resolvedRules.reviveThreshold }

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
      rules,
      history: [],
      resolution: null,
      isCommissionerView: targetUserId !== session.user.id,
      experienceMode: z.experienceMode,
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

  const coWhisperer = await prisma.zombieCoWhisperer.findUnique({
    where: { zombieLeagueId_userId: { zombieLeagueId: z.id, userId: targetUserId } },
    select: { userId: true, ambushesRemaining: true },
  })
  const ownWhisperer = whisperer?.userId === targetUserId ? whisperer : coWhisperer

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

  let appliedItemBonus: unknown = null
  if (z.sport === 'NFL') {
    const season = await prisma.redraftSeason.findFirst({ where: { leagueId, season: z.season }, select: { id: true } })
    const nativeRoster = season && await prisma.redraftRoster.findFirst({ where: { seasonId: season.id, ownerId: targetUserId }, select: { id: true } })
    const matchup = nativeRoster && await prisma.redraftMatchup.findFirst({ where: { seasonId: season!.id, week, OR: [{ homeRosterId: nativeRoster.id }, { awayRosterId: nativeRoster.id }] }, select: { homeRosterId: true, lineupSnapshots: true } })
    const receipt = (matchup?.lineupSnapshots as { zombieItems?: { policy?: string; home?: unknown; away?: unknown } } | null)?.zombieItems
    if (receipt?.policy === 'beta_2025') appliedItemBonus = matchup?.homeRosterId === nativeRoster?.id ? receipt.home : receipt.away
  }

  return NextResponse.json({
    items: team?.items ?? [],
    appliedItemBonus,
    weekBecameZombie: team?.weekBecameZombie ?? null,
    itemPolicy: z.sport.toUpperCase() === 'NFL' ? 'beta_2025' : 'legacy',
    teamStatus: team?.status ?? 'Survivor',
    rules,
    history,
    resolution,
    // Only a viewer allowed to know the Whisperer learns who it is.
    whispererUserId: viewer.canSee ? (ownWhisperer?.userId ?? whisperer?.userId ?? null) : null,
    isWhisperer: Boolean(ownWhisperer),
    ambushesRemaining: ownWhisperer?.ambushesRemaining ?? null,
    isCommissionerView: targetUserId !== session.user.id,
    isPaid: z.isPaid,
    experienceMode: z.experienceMode,
    week,
    pendingBashingDecision,
  })
}

