import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requireCommissionerRole } from '@/lib/league/permissions'
import { markDuesPaidManual } from '@/lib/league-finance/leagueFinanceService'
import { normalizeManualPaymentProvider } from '@/lib/league-finance/manualPaymentPresets'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { leagueId } = await ctx.params

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
  const amountCents = typeof body.amountCents === 'number' ? body.amountCents : null
  if (!targetUserId || amountCents == null || !Number.isFinite(amountCents)) {
    return NextResponse.json({ error: 'targetUserId and amountCents required' }, { status: 400 })
  }

  const externalReference =
    typeof body.externalReference === 'string' ? body.externalReference : undefined
  const providerRaw = typeof body.paymentProvider === 'string' ? body.paymentProvider : undefined
  const provider = normalizeManualPaymentProvider(providerRaw)

  try {
    await markDuesPaidManual({
      leagueId,
      targetUserId,
      actorUserId: userId,
      amountCents,
      externalReference,
      provider,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to record payment'
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
