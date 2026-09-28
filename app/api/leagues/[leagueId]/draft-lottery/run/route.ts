/**
 * POST: Run weighted lottery (commissioner). Body: { seed?: string; confirm: boolean }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { prisma } from '@/lib/prisma'
import {
  getDraftOrderModeAndLotteryConfig,
  setDraftOrderModeAndLotteryConfig,
} from '@/lib/draft-lottery/lotteryConfigStorage'
import { runWeightedLottery } from '@/lib/draft-lottery/WeightedDraftLotteryEngine'
import { checkDynastyLotteryEligibility } from '@/lib/draft-lottery/dynastyYearGuard'
import type { SlotOrderEntry } from '@/lib/live-draft-engine/types'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export const dynamic = 'force-dynamic'

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

  const commissioner = await isCommissioner(leagueId, userId)
  if (!commissioner) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const lotteryEligibility = await checkDynastyLotteryEligibility(leagueId)
  if (!lotteryEligibility.eligible) {
    return NextResponse.json({ error: lotteryEligibility.reason }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as { seed?: string; confirm?: boolean }
  if (body.confirm !== true) {
    return NextResponse.json({ error: 'confirm must be true' }, { status: 400 })
  }

  const seed =
    typeof body.seed === 'string' && body.seed.trim()
      ? body.seed.trim()
      : `${leagueId}-${Date.now()}-${userId}`

  const { lotteryConfig } = await getDraftOrderModeAndLotteryConfig(leagueId)
  const config = { ...lotteryConfig, enabled: true, randomSeed: seed, auditSeed: seed }

  const result = await runWeightedLottery(leagueId, config, seed)
  if (!result) return NextResponse.json({ error: 'Could not run lottery' }, { status: 500 })

  const runAtIso = new Date().toISOString()

  await setDraftOrderModeAndLotteryConfig(leagueId, {
    draftOrderMode: 'weighted_lottery',
    lotteryLastSeed: seed,
    lotteryLastRunAt: runAtIso,
    lotteryLastResult: result,
    lotteryConfig: { auditSeed: seed, randomSeed: seed },
  })

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { season: true },
  })
  const sessionRow = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { id: true, status: true },
  })

  if (sessionRow?.status === 'pre_draft') {
    const slotOrder = result.slotOrder as SlotOrderEntry[]
    await prisma.draftSession.update({
      where: { id: sessionRow.id },
      data: {
        slotOrder: slotOrder as any,
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    })
  }

  return NextResponse.json({
    ...result,
    leagueSeason: league?.season ?? null,
  })
}
