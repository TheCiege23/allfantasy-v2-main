import { withPaidToolBilling } from '@/lib/tokens/paidToolBilling'
/**
 * GET: Big Brother AI context (deterministic). POST: Generate AI narrative (host, challenge, recap, game theory, social, finale).
 * Entitlements: `big_brother_ai` (player), `big_brother_host_ai` (commissioner host). AF Tokens meter deeper runs.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isBigBrotherLeague } from '@/lib/big-brother/BigBrotherLeagueConfig'
import { buildBigBrotherAIContext } from '@/lib/big-brother/ai/BigBrotherAIContext'
import { getRosterDisplayNamesForLeague } from '@/lib/big-brother/ai/getRosterDisplayNames'
import type { BigBrotherAIPromptType } from '@/lib/big-brother/ai/BigBrotherAIPrompts'
import { generateBigBrotherAI } from '@/lib/big-brother/ai/BigBrotherAIService'
import { resolveBigBrotherAiAccess } from '@/lib/big-brother/big-brother-ai-route-guard'
import { TokenSpendService } from '@/lib/tokens/TokenSpendService'

export const dynamic = 'force-dynamic'

const VALID_TYPES: BigBrotherAIPromptType[] = [
  'chimmy_host',
  'challenge_generator_hoh',
  'challenge_generator_veto',
  'recap',
  'game_theory',
  'social_strategy',
  'finale_moderator',
  'rule_explain',
]

const BigBrotherAiPostSchema = z.object({
  type: z.string().optional(),
  explainTerm: z.string().optional().nullable(),
  confirmTokenSpend: z.boolean().optional().default(false),
})

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isBB = await isBigBrotherLeague(leagueId)
  if (!isBB) return NextResponse.json({ error: 'Not a Big Brother league' }, { status: 404 })

  const ctxData = await buildBigBrotherAIContext(leagueId, 'chimmy_host')
  if (!ctxData) return NextResponse.json({ error: 'Could not build context' }, { status: 500 })

  const rosterIds = [
    ctxData.hohRosterId,
    ctxData.nominee1RosterId,
    ctxData.nominee2RosterId,
    ...ctxData.finalNomineeRosterIds,
    ...ctxData.juryRosterIds,
    ...ctxData.eliminatedRosterIds,
  ].filter(Boolean) as string[]
  const rosterDisplayNames = await getRosterDisplayNamesForLeague(leagueId, rosterIds.length ? rosterIds : undefined)

  return NextResponse.json({
    context: ctxData,
    rosterDisplayNames,
    validTypes: VALID_TYPES,
  })
}

async function paidToolPost(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string; email?: string | null }
  } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  let body: z.infer<typeof BigBrotherAiPostSchema>
  try {
    body = BigBrotherAiPostSchema.parse(await req.json().catch(() => ({})))
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isBB = await isBigBrotherLeague(leagueId)
  if (!isBB) return NextResponse.json({ error: 'Not a Big Brother league' }, { status: 404 })

  const type = (body.type ?? 'chimmy_host') as BigBrotherAIPromptType

  const access = await resolveBigBrotherAiAccess({
    userId,
    userEmail: session?.user?.email,
    leagueId,
    type,
    confirmTokenSpend: Boolean(body.confirmTokenSpend),
  })
  if (!access.ok) return access.response

  const refundLedgerId = access.tokenSpend?.id ?? null

  let ctxData = await buildBigBrotherAIContext(leagueId, 'chimmy_host')
  if (!ctxData) {
    if (refundLedgerId) {
      await new TokenSpendService()
        .refundSpendByLedger({
          userId,
          spendLedgerId: refundLedgerId,
          refundRuleCode: 'feature_execution_failed',
          sourceType: 'big_brother_ai_refund',
          sourceId: refundLedgerId,
          idempotencyKey: `refund:big_brother_ai:${refundLedgerId}`,
          description: 'Auto refund after failed Big Brother AI context build.',
          metadata: { leagueId, type },
        })
        .catch(() => null)
    }
    return NextResponse.json({ error: 'Could not build context' }, { status: 500 })
  }

  const term = typeof body.explainTerm === 'string' ? body.explainTerm.trim() : ''
  if (term) {
    ctxData = { ...ctxData, explainTerm: term }
  }

  try {
    const { narrative, model } = await generateBigBrotherAI(ctxData, type, userId)
    return NextResponse.json({
      narrative,
      model,
      type,
      context: ctxData,
      entitlement: access.featureDecision,
      tokenSpend: access.tokenSpend,
    })
  } catch (e) {
    console.error('[big-brother/ai]', e)
    if (refundLedgerId) {
      await new TokenSpendService()
        .refundSpendByLedger({
          userId,
          spendLedgerId: refundLedgerId,
          refundRuleCode: 'feature_execution_failed',
          sourceType: 'big_brother_ai_refund',
          sourceId: refundLedgerId,
          idempotencyKey: `refund:big_brother_ai_fail:${refundLedgerId}`,
          description: 'Auto refund after Big Brother AI generation failure.',
          metadata: { leagueId, type },
        })
        .catch(() => null)
    }
    return NextResponse.json(
      { error: 'AI generation failed', message: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export const POST = withPaidToolBilling(paidToolPost)
