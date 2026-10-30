/**
 * PROMPT 3: C2C promotion center. GET: list promotion-eligible rights. POST: manager or commissioner submits promotion.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft, canSubmitPickForRoster } from '@/lib/live-draft-engine/auth'
import { prisma } from '@/lib/prisma'
import { isC2CLeague, getC2CConfig } from '@/lib/merged-devy-c2c/C2CLeagueConfig'
import {
  checkC2CPromotionEligibility,
  executeC2CPromotion,
} from '@/lib/merged-devy-c2c/promotion/C2CPromotionService'
import { C2C_LIFECYCLE_STATE } from '@/lib/merged-devy-c2c/types'
import { DEVY_LIFECYCLE_STATE } from '@/lib/devy/types'

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

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isC2C = await isC2CLeague(leagueId)
  if (!isC2C) return NextResponse.json({ error: 'Not a C2C league' }, { status: 404 })

  const rosterId = req.nextUrl.searchParams?.get('rosterId') ?? undefined
  const seasonYear = parseInt(req.nextUrl.searchParams?.get('seasonYear') ?? String(getSeasonYear()), 10)

  const where: { leagueId: string; state: { in: string[] }; rosterId?: string } = {
    leagueId,
    state: { in: [C2C_LIFECYCLE_STATE.PROMOTION_ELIGIBLE, DEVY_LIFECYCLE_STATE.PROMOTION_ELIGIBLE] },
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

  return NextResponse.json({
    eligible: list,
    seasonYear,
    config: await getC2CConfig(leagueId).then((c) =>
      c ? { promotionTiming: c.promotionTiming, maxPromotionsPerYear: c.maxPromotionsPerYear } : null
    ),
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

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isC2C = await isC2CLeague(leagueId)
  if (!isC2C) return NextResponse.json({ error: 'Not a C2C league' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const { rightsId, promotedProPlayerId, addToRoster } = body
  if (!rightsId || !promotedProPlayerId) {
    return NextResponse.json({ error: 'rightsId and promotedProPlayerId required' }, { status: 400 })
  }

  const seasonYear = getSeasonYear()
  const right = await prisma.devyRights.findUnique({ where: { id: rightsId } })
  if (!right || right.leagueId !== leagueId) {
    return NextResponse.json({ error: 'Rights not found' }, { status: 404 })
  }

  const canManageRoster = await canSubmitPickForRoster(leagueId, userId, right.rosterId)
    || Boolean(await prisma.leagueTeam.findFirst({
      where: { leagueId, externalId: right.rosterId, claimedByUserId: userId },
      select: { id: true },
    }))
  if (!canManageRoster) {
    return NextResponse.json({ error: 'Only the rights holder or commissioner can promote' }, { status: 403 })
  }

  const eligibility = await checkC2CPromotionEligibility({
    leagueId,
    rosterId: right.rosterId,
    rightsId,
    seasonYear,
  })
  if (!eligibility.canPromote) {
    return NextResponse.json({ error: eligibility.reason ?? 'Cannot promote' }, { status: 400 })
  }

  const result = await executeC2CPromotion({
    rightsId,
    promotedProPlayerId: String(promotedProPlayerId),
    addToRoster: addToRoster === true,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
