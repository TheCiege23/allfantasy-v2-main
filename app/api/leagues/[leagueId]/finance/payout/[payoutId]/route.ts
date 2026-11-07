import { NextRequest, NextResponse } from 'next/server'
import { leagueMoneyRefusal } from '@/lib/monetization/leagueEntryFeeKillSwitch'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getLeagueRole } from '@/lib/league/permissions'
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
  const role = await getLeagueRole(leagueId, userId)
  if (role !== 'commissioner' && role !== 'co_commissioner') {
    return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  }

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
