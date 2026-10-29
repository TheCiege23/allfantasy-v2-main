import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { LeagueTreasuryProvider } from '@prisma/client'
import { requireCommissionerRole } from '@/lib/league/permissions'
import { updateFinanceSettings } from '@/lib/league-finance/leagueFinanceService'

export const dynamic = 'force-dynamic'

const PROVIDERS = new Set<string>(Object.values(LeagueTreasuryProvider))

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
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

  const hasAny =
    typeof body.isPaidLeague === 'boolean' ||
    typeof body.entryFeeCents === 'number' ||
    typeof body.allowManualPaymentMark === 'boolean' ||
    typeof body.treasuryProvider === 'string' ||
    typeof body.externalEscrowUrl === 'string' ||
    body.externalEscrowUrl === null ||
    typeof body.externalEscrowLabel === 'string' ||
    body.externalEscrowLabel === null
  if (!hasAny) {
    return NextResponse.json({ error: 'No updates' }, { status: 400 })
  }

  const treasuryProviderRaw =
    typeof body.treasuryProvider === 'string' ? body.treasuryProvider : undefined
  if (treasuryProviderRaw !== undefined && !PROVIDERS.has(treasuryProviderRaw)) {
    return NextResponse.json({ error: 'Invalid treasuryProvider' }, { status: 400 })
  }

  await updateFinanceSettings({
    leagueId,
    actorUserId: userId,
    patch: {
      ...(typeof body.isPaidLeague === 'boolean' ? { isPaidLeague: body.isPaidLeague } : {}),
      ...(typeof body.entryFeeCents === 'number' ? { entryFeeCents: body.entryFeeCents } : {}),
      ...(typeof body.allowManualPaymentMark === 'boolean'
        ? { allowManualPaymentMark: body.allowManualPaymentMark }
        : {}),
      ...(treasuryProviderRaw !== undefined
        ? { treasuryProvider: treasuryProviderRaw as LeagueTreasuryProvider }
        : {}),
      ...(typeof body.externalEscrowUrl === 'string' || body.externalEscrowUrl === null
        ? { externalEscrowUrl: body.externalEscrowUrl as string | null }
        : {}),
      ...(typeof body.externalEscrowLabel === 'string' || body.externalEscrowLabel === null
        ? { externalEscrowLabel: body.externalEscrowLabel as string | null }
        : {}),
    },
  })

  return NextResponse.json({ ok: true })
}
