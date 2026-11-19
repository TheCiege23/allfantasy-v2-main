/**
 * POST: Run weighted lottery (commissioner). PROMPT 339. Deterministic with seed.
 */

import { assertCommissionerAccess } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isSalaryCapLeague } from '@/lib/salary-cap/SalaryCapLeagueConfig'
import { runWeightedLottery } from '@/lib/salary-cap/WeightedLotteryService'
import type { LotterySlot } from '@/lib/salary-cap/WeightedLotteryService'

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

  try {
    await assertCommissionerAccess(leagueId, userId, 'league')
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const isCap = await isSalaryCapLeague(leagueId)
  if (!isCap) return NextResponse.json({ error: 'Not a salary cap league' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const slots = body.slots as LotterySlot[] | undefined
  const seed = String(body.seed ?? `lottery-${leagueId}-${Date.now()}`)
  if (!Array.isArray(slots) || slots.length === 0) {
    return NextResponse.json(
      { error: 'Body must include slots: [{ slot, rosterId, originalOrder, weight }]' },
      { status: 400 }
    )
  }

  const validSlots = slots.map((s: { slot?: number; rosterId?: string; originalOrder?: number; weight?: number }) => ({
    slot: Number(s.slot ?? 0),
    rosterId: String(s.rosterId ?? ''),
    originalOrder: Number(s.originalOrder ?? 0),
    weight: Number(s.weight ?? 1),
  }))
  const result = await runWeightedLottery(leagueId, validSlots, seed)
  return NextResponse.json({ ok: true, order: result.order, seed: result.seed })
}
