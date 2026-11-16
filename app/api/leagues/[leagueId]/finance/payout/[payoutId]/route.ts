import { commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { leagueMoneyRefusal } from '@/lib/monetization/leagueEntryFeeKillSwitch'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { decidePayout, setPayoutFrozen } from '@/lib/league-finance/leagueFinanceService'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string; payoutId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { leagueId, payoutId } = await ctx.params

  const moneyOff = leagueMoneyRefusal('payout decisions')
  if (moneyOff) return NextResponse.json({ error: moneyOff.error, code: moneyOff.code }, { status: moneyOff.status })
  // Payouts are money: a co-commissioner needs that area (lib/league/commissionerAccess.ts). This let any
  // co-commissioner approve or freeze a payout (2026-11-16).
  const refused = await commissionerAccessResponse(leagueId, userId, 'money')
  if (refused) return refused

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const action = typeof body.action === 'string' ? body.action : null
  const note = typeof body.note === 'string' ? body.note : undefined

  try {
    if (action === 'freeze') {
      await setPayoutFrozen({
        payoutId,
        leagueId,
        actorUserId: userId,
        freeze: true,
        reason: note,
      })
      return NextResponse.json({ ok: true })
    }
    if (action === 'unfreeze') {
      await setPayoutFrozen({
        payoutId,
        leagueId,
        actorUserId: userId,
        freeze: false,
        reason: note,
      })
      return NextResponse.json({ ok: true })
    }
    if (action === 'approve' || action === 'reject' || action === 'paid') {
      const decision: 'approved' | 'rejected' | 'paid' =
        action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'paid'
      await decidePayout({
        payoutId,
        leagueId,
        actorUserId: userId,
        decision,
        note,
      })
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json(
      { error: 'Invalid action (approve | reject | paid | freeze | unfreeze)' },
      { status: 400 },
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Payout update failed'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
