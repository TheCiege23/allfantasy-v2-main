import { withPaidToolBilling } from '@/lib/tokens/paidToolBilling'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { runAICommissionerCycle } from '@/lib/ai-commissioner'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'
import { TokenSpendService } from '@/lib/tokens/TokenSpendService'

export const dynamic = 'force-dynamic'

async function paidToolPost(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string; email?: string | null }
  } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await assertCommissioner(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as Partial<{
    sport: string
    season: number | string
    confirmTokenSpend: boolean
  }>
  const confirmTokenSpend = body.confirmTokenSpend === true
  const seasonCandidate =
    typeof body?.season === 'number'
      ? body.season
      : typeof body?.season === 'string'
        ? Number.parseInt(body.season, 10)
        : NaN
  const season =
    Number.isFinite(seasonCandidate) && !Number.isNaN(seasonCandidate) ? seasonCandidate : null

  const gate = await requireFeatureEntitlement({
    userId,
    userEmail: session?.user?.email,
    featureId: 'commissioner_automation',
    allowTokenFallback: true,
    confirmTokenSpend,
    tokenRuleCode: 'commissioner_ai_cycle_run',
    tokenSourceType: 'commissioner_ai_cycle',
    tokenSourceId: `${leagueId}:${season ?? 'auto'}:${Date.now()}`,
    tokenDescription: 'AI Commissioner cycle run',
    tokenMetadata: {
      leagueId,
      sport: body?.sport ?? null,
      season,
    },
  })
  if (!gate.ok) return gate.response

  const spendService = new TokenSpendService()
  const spendLedgerId = gate.tokenSpend?.id ?? null
  try {
    const result = await runAICommissionerCycle({
      leagueId,
      sport: body?.sport ?? null,
      season,
      source: 'commissioner_ui',
    })

    return NextResponse.json({
      ...result,
      tokenSpend: gate.tokenSpend
        ? {
            ruleCode: gate.tokenPreview?.ruleCode ?? 'commissioner_ai_cycle_run',
            tokenCost: gate.tokenPreview?.tokenCost ?? null,
            balanceAfter: gate.tokenSpend.balanceAfter,
            ledgerId: gate.tokenSpend.id,
          }
        : null,
    })
  } catch (error) {
    if (spendLedgerId) {
      await spendService
        .refundSpendByLedger({
          userId,
          spendLedgerId,
          refundRuleCode: 'feature_execution_failed',
          sourceType: 'commissioner_ai_cycle_refund',
          sourceId: spendLedgerId,
          idempotencyKey: `refund:commissioner_ai_cycle:${spendLedgerId}`,
          description: 'Auto refund after failed AI Commissioner run.',
          metadata: { leagueId },
        })
        .catch(() => null)
    }

    console.error('[ai-commissioner/run POST]', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'AI Commissioner run failed' }, { status: 500 })
  }
}

export const POST = withPaidToolBilling(paidToolPost)
