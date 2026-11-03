/**
 * PROMPT 3: Offseason promotion panel.
 * GET: list promotion-eligible devy rights for the league (and per-roster if rosterId provided).
 * POST: manager or commissioner submits promotion (rightsId + promotedProPlayerId).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isDevyLeague, getDevyConfig } from '@/lib/devy'
import { checkPromotionEligibility, executePromotion } from '@/lib/devy'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { DEVY_LIFECYCLE_STATE } from '@/lib/devy/types'
import { getPromotionWindowStatus } from '@/lib/devy/lifecycle/DevyLifecycleAutomation'
import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'

export const dynamic = 'force-dynamic'

function getSeasonYear(): number {
  const d = new Date()
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const isDevy = await isDevyLeague(leagueId)
  if (!isDevy) return NextResponse.json({ error: 'Not a devy dynasty league' }, { status: 404 })

  const rosterId = req.nextUrl.searchParams?.get('rosterId') ?? undefined
  const seasonYear = parseInt(req.nextUrl.searchParams?.get('seasonYear') ?? String(getSeasonYear()), 10)

  const where: { leagueId: string; state: string; rosterId?: string } = {
    leagueId,
    state: DEVY_LIFECYCLE_STATE.PROMOTION_ELIGIBLE,
  }
  if (rosterId) where.rosterId = rosterId

  const rights = await prisma.devyRights.findMany({
    where,
    include: {
      roster: { select: { id: true, platformUserId: true } },
    },
  })

  const devyPlayerIds = [...new Set(rights.map((r) => r.devyPlayerId))]
  const devyPlayers = await prisma.devyPlayer.findMany({
    where: { id: { in: devyPlayerIds } },
    select: { id: true, name: true, position: true, school: true, draftEligibleYear: true },
  })
  const devyMap = new Map(devyPlayers.map((p) => [p.id, p]))

  const list = rights.map((r) => {
    const devy = devyMap.get(r.devyPlayerId)
    return {
      rightsId: r.id,
      rosterId: r.rosterId,
      platformUserId: r.roster.platformUserId,
      devyPlayerId: r.devyPlayerId,
      devyPlayer: devy
        ? { name: devy.name, position: devy.position, school: devy.school, draftEligibleYear: devy.draftEligibleYear }
        : null,
      promotedProPlayerId: r.promotedProPlayerId,
      seasonYear: r.seasonYear,
    }
  })

  const [config, promotionWindow] = await Promise.all([
    getDevyConfig(leagueId).then((c) =>
      c ? { promotionTiming: c.promotionTiming, maxYearlyDevyPromotions: c.maxYearlyDevyPromotions } : null
    ),
    getPromotionWindowStatus(leagueId),
  ])

  return NextResponse.json({
    eligible: list,
    seasonYear,
    config,
    promotionWindow,
  })
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const isDevy = await isDevyLeague(leagueId)
  if (!isDevy) return NextResponse.json({ error: 'Not a devy dynasty league' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const { rightsId, promotedProPlayerId, addToRoster } = body
  if (!rightsId || !promotedProPlayerId) {
    return NextResponse.json({ error: 'rightsId and promotedProPlayerId required' }, { status: 400 })
  }

  const right = await prisma.devyRights.findUnique({ where: { id: rightsId } })
  if (!right || right.leagueId !== leagueId) {
    return NextResponse.json({ error: 'Rights not found' }, { status: 404 })
  }

  const commissioner = await isCommissioner(leagueId, userId)
  const roster = await prisma.roster.findFirst({
    where: { leagueId, id: right.rosterId },
    select: { platformUserId: true },
  })
  const isOwner = roster?.platformUserId === userId || (await acceptedCoOwnerRosterId(leagueId, userId)) === right.rosterId
  if (!commissioner && !isOwner) {
    return NextResponse.json({ error: 'Only the rights holder or commissioner can promote' }, { status: 403 })
  }

  const seasonYear = getSeasonYear()
  const eligibility = await checkPromotionEligibility({
    leagueId,
    rosterId: right.rosterId,
    rightsId,
    seasonYear,
  })
  if (!eligibility.canPromote && !commissioner) {
    return NextResponse.json(
      { error: eligibility.reason ?? 'Promotion not allowed', eligibility },
      { status: 400 }
    )
  }

  const result = commissioner
    ? await executePromotion({ rightsId, promotedProPlayerId, addToRoster: addToRoster !== false })
    : await executePromotion({ rightsId, promotedProPlayerId, addToRoster: addToRoster === true })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
