import { NextRequest, NextResponse } from 'next/server'
import { leagueMoneyRefusal } from '@/lib/monetization/leagueEntryFeeKillSwitch'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getLeagueRole } from '@/lib/league/permissions'
import { createPayoutRequest } from '@/lib/league-finance/leagueFinanceService'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { leagueId } = await ctx.params

  const moneyOff = leagueMoneyRefusal('payout requests')
  if (moneyOff) return NextResponse.json({ error: moneyOff.error, code: moneyOff.code }, { status: moneyOff.status })
  const role = await getLeagueRole(leagueId, userId)
  if (!role || role === 'viewer') {
    return NextResponse.json({ error: 'Members only' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const amountCents = typeof body.amountCents === 'number' ? body.amountCents : null
  if (amountCents == null || !Number.isFinite(amountCents) || amountCents <= 0) {
    return NextResponse.json({ error: 'amountCents required' }, { status: 400 })
  }

  const recipientNote = typeof body.recipientNote === 'string' ? body.recipientNote : undefined

  try {
    const row = await createPayoutRequest({
      leagueId,
      requestedByUserId: userId,
      amountCents,
      recipientNote,
    })
    return NextResponse.json({ id: row.id })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Could not create payout request'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
