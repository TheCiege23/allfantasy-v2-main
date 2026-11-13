import { NextRequest, NextResponse } from 'next/server'
import { leagueMoneyRefusal } from '@/lib/monetization/leagueEntryFeeKillSwitch'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requireCommissionerRole } from '@/lib/league/permissions'
import { waiveDues } from '@/lib/league-finance/leagueFinanceService'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { leagueId } = await ctx.params

  const moneyOff = leagueMoneyRefusal('in-app dues waivers')
  if (moneyOff) return NextResponse.json({ error: moneyOff.error, code: moneyOff.code }, { status: moneyOff.status })

  try {
    await requireCommissionerRole(leagueId, userId, 'money')
  } catch (e) {
    if (e instanceof Response) {
      const body = await e.json().catch(() => ({}))
      return NextResponse.json(body, { status: e.status })
    }
    throw e
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId : null
  if (!targetUserId) {
    return NextResponse.json({ error: 'targetUserId required' }, { status: 400 })
  }

  const note = typeof body.note === 'string' ? body.note : undefined

  await waiveDues({
    leagueId,
    targetUserId,
    actorUserId: userId,
    note,
  })

  return NextResponse.json({ ok: true })
}
