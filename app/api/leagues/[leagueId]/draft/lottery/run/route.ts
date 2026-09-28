/**
 * POST: Run weighted lottery. Optionally finalize (write slotOrder to draft session).
 * Commissioner only for finalize.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { prisma } from '@/lib/prisma'
import { getDraftOrderModeAndLotteryConfig, setDraftOrderModeAndLotteryConfig } from '@/lib/draft-lottery/lotteryConfigStorage'
import { runWeightedLottery } from '@/lib/draft-lottery/WeightedDraftLotteryEngine'
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

  const body = await req.json().catch(() => ({}))
  const finalize = Boolean(body.finalize)
  const seed = typeof body.seed === 'string' && body.seed.trim() ? body.seed.trim() : `lottery-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`

  if (finalize) {
    const commissioner = await isCommissioner(leagueId, userId)
    if (!commissioner) return NextResponse.json({ error: 'Commissioner only to finalize lottery' }, { status: 403 })
  }

  const { lotteryConfig } = await getDraftOrderModeAndLotteryConfig(leagueId)
  const config = { ...lotteryConfig, enabled: true, randomSeed: seed, auditSeed: seed }

  const result = await runWeightedLottery(leagueId, config, seed)
  if (!result) return NextResponse.json({ error: 'Could not run lottery' }, { status: 500 })

  if (finalize) {
    const draftSession = await prisma.draftSession.findFirst({
      where: { leagueId },
      orderBy: CURRENT_DRAFT_SESSION_ORDER,
      select: { id: true, status: true },
    })
    if (!draftSession || draftSession.status !== 'pre_draft') {
      return NextResponse.json(
        { error: 'No draft session in pre_draft status. Create or reset draft first.' },
        { status: 400 }
      )
    }
    const slotOrder = result.slotOrder as SlotOrderEntry[]
    await prisma.draftSession.update({
      where: { id: draftSession.id },
      data: {
        slotOrder: slotOrder as any,
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    })
    await setDraftOrderModeAndLotteryConfig(leagueId, {
      lotteryLastSeed: seed,
      lotteryLastRunAt: result.runAt,
      lotteryLastResult: result,
      lotteryConfig: { auditSeed: seed, randomSeed: seed },
    })
  }

  return NextResponse.json({
    lotteryDraws: result.lotteryDraws,
    fallbackOrder: result.fallbackOrder,
    slotOrder: result.slotOrder,
    seed: result.seed,
    runAt: result.runAt,
    finalized: finalize,
    oddsSnapshot: result.oddsSnapshot,
  })
}
