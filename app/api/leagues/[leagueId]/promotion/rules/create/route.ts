import { assertCommissionerAccess } from '@/lib/league/commissionerAccess'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * POST /api/leagues/[leagueId]/promotion/rules/create
 * Body: { fromTierLevel: number, toTierLevel: number, promoteCount: number, relegateCount: number }
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
    try {
      await assertCommissionerAccess(leagueId, userId, 'league')
    } catch {
      return NextResponse.json({ error: 'Forbidden: commissioner only' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const fromTierLevel =
      typeof body.fromTierLevel === 'number' && Number.isInteger(body.fromTierLevel)
        ? body.fromTierLevel
        : 1
    const toTierLevel =
      typeof body.toTierLevel === 'number' && Number.isInteger(body.toTierLevel)
        ? body.toTierLevel
        : 2
    const promoteCount =
      typeof body.promoteCount === 'number' && Number.isInteger(body.promoteCount)
        ? body.promoteCount
        : 1
    const relegateCount =
      typeof body.relegateCount === 'number' && Number.isInteger(body.relegateCount)
        ? body.relegateCount
        : 1
    if (fromTierLevel < 1 || toTierLevel < 1) {
      return NextResponse.json({ error: 'Tier levels must be positive integers' }, { status: 400 })
    }
    if (fromTierLevel >= toTierLevel) {
      return NextResponse.json({ error: 'fromTierLevel must be higher tier than toTierLevel' }, { status: 400 })
    }
    if (promoteCount < 0 || relegateCount < 0) {
      return NextResponse.json({ error: 'Counts must be non-negative integers' }, { status: 400 })
    }
    if (promoteCount === 0 && relegateCount === 0) {
      return NextResponse.json({ error: 'At least one of promoteCount or relegateCount must be > 0' }, { status: 400 })
    }

    const rule = await prisma.promotionRule.upsert({
      where: {
        leagueId_fromTierLevel_toTierLevel: {
          leagueId,
          fromTierLevel,
          toTierLevel,
        },
      },
      create: {
        leagueId,
        fromTierLevel,
        toTierLevel,
        promoteCount,
        relegateCount,
      },
      update: { promoteCount, relegateCount },
    })

    return NextResponse.json({
      ruleId: rule.id,
      leagueId: rule.leagueId,
      fromTierLevel: rule.fromTierLevel,
      toTierLevel: rule.toTierLevel,
      promoteCount: rule.promoteCount,
      relegateCount: rule.relegateCount,
    })
  } catch (e) {
    console.error('[promotion rules create POST]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to create rule' },
      { status: 500 }
    )
  }
}
