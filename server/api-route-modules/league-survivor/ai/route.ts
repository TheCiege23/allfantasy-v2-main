import { withPaidToolBilling, paidToolNotDelivered } from '@/lib/tokens/paidToolBilling'
/**
 * POST: Survivor AI — host posts and helper strategy. Deterministic context first; AI narrates/advises only.
 * PROMPT 348: No AI for elimination, vote count, idol validity, immunity, or exile return.
 *
 * Entitlements: `survivor_ai` (player strategy), `survivor_host_ai` (commissioner host narration).
 * AF Tokens: fallback when unsubscribed; 2–3 token rules also charge subscribed users (confirmTokenSpend).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isSurvivorLeague } from '@/lib/survivor/SurvivorLeagueConfig'
import { buildSurvivorAIContext } from '@/lib/survivor/ai/SurvivorAIContext'
import type { SurvivorAIType } from '@/lib/survivor/ai/SurvivorAIContext'
import {
  buildSurvivorAiCacheContextSummary,
  generateSurvivorAI,
} from '@/lib/survivor/ai/SurvivorAIService'
import { resolveSurvivorCurrentWeek } from '@/lib/survivor/SurvivorTimelineResolver'
import { resolveSurvivorAiAccess } from '@/lib/survivor/survivor-ai-route-guard'
import { TokenSpendService } from '@/lib/tokens/TokenSpendService'
import {
  buildAiCacheKey,
  createSmokeAiResult,
  isAiResultCacheSmokeProviderEnabled,
  readAiResultCache,
  writeAiResultCache,
} from '@/lib/ai-result-cache'

export const dynamic = 'force-dynamic'
const SURVIVOR_AI_CACHE_TTL_MS = 30 * 60 * 1000

const SurvivorAiPostSchema = z.object({
  type: z.string().optional(),
  week: z.union([z.number(), z.string()]).optional().nullable(),
  currentWeek: z.union([z.number(), z.string()]).optional().nullable(),
  confirmTokenSpend: z.boolean().optional().default(false),
})

function toDeterministicResponse(
  deterministic: NonNullable<Awaited<ReturnType<typeof buildSurvivorAIContext>>>
) {
  return {
    leagueId: deterministic.leagueId,
    sport: deterministic.sport,
    currentWeek: deterministic.currentWeek,
    config: deterministic.config,
    tribes: deterministic.tribes,
    council: deterministic.council
      ? {
          id: deterministic.council.id,
          week: deterministic.council.week,
          phase: deterministic.council.phase,
          attendingTribeId: deterministic.council.attendingTribeId,
          voteDeadlineAt: deterministic.council.voteDeadlineAt.toISOString(),
          closedAt: deterministic.council.closedAt?.toISOString() ?? null,
          eliminatedRosterId: deterministic.council.eliminatedRosterId,
        }
      : null,
    challenges: deterministic.challenges,
    jury: deterministic.jury,
    exileLeagueId: deterministic.exileLeagueId,
    exileTokens: deterministic.exileTokens,
    votedOutHistory: deterministic.votedOutHistory,
    merged: deterministic.merged,
    rosterDisplayNames: deterministic.rosterDisplayNames,
    myRosterId: deterministic.myRosterId,
    myIdols: deterministic.myIdols,
    myActiveEffects: deterministic.myActiveEffects,
    myExileStatus: deterministic.myExileStatus,
    finale: deterministic.finale,
  }
}

async function paidToolPost(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string; email?: string | null } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  let body: z.infer<typeof SurvivorAiPostSchema>
  try {
    body = SurvivorAiPostSchema.parse(await req.json().catch(() => ({})))
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isSurvivor = await isSurvivorLeague(leagueId)
  if (!isSurvivor) return NextResponse.json({ error: 'Not a survivor league' }, { status: 404 })

  const type = (body.type ?? 'tribe_help') as SurvivorAIType

  const access = await resolveSurvivorAiAccess({
    userId,
    userEmail: session?.user?.email,
    leagueId,
    type,
    confirmTokenSpend: Boolean(body.confirmTokenSpend),
  })
  if (!access.ok) return access.response

  const refundLedgerId = access.tokenSpend?.id ?? null

  const requestedWeekRaw = body.week ?? body.currentWeek ?? null
  const requestedWeek =
    requestedWeekRaw != null ? Math.max(1, parseInt(String(requestedWeekRaw), 10) || 1) : null
  const currentWeek = await resolveSurvivorCurrentWeek(leagueId, requestedWeek)

  const deterministic = await buildSurvivorAIContext({
    leagueId,
    currentWeek,
    userId,
  })
  if (!deterministic) {
    if (refundLedgerId) {
      await new TokenSpendService()
        .refundSpendByLedger({
          userId,
          spendLedgerId: refundLedgerId,
          refundRuleCode: 'feature_execution_failed',
          sourceType: 'survivor_ai_refund',
          sourceId: refundLedgerId,
          idempotencyKey: `refund:survivor_ai:${refundLedgerId}`,
          description: 'Auto refund after failed Survivor AI context build.',
          metadata: { leagueId, type },
        })
        .catch(() => null)
    }
    return NextResponse.json({ error: 'Could not build context' }, { status: 500 })
  }

  const deterministicResponse = toDeterministicResponse(deterministic)
  const cacheInputs = {
    leagueId,
    type,
    requestedWeek,
    currentWeek,
    userId,
    myRosterId: deterministic.myRosterId,
    councilAttendingTribeId: deterministic.council?.attendingTribeId ?? null,
    tribeIds: deterministic.tribes.map((tribe) => tribe.id).sort(),
    contextSummary: buildSurvivorAiCacheContextSummary(deterministic),
  }
  const { resultKey, inputHash } = buildAiCacheKey('survivor-ai', cacheInputs)
  const cached = await readAiResultCache(resultKey)
  if (cached?.resultJson && typeof cached.resultJson === 'object') {
    // Cached content has no new paid generation. Never repeat old wallet metadata.
    paidToolNotDelivered()
    return NextResponse.json({ ...(cached.resultJson as Record<string, unknown>), tokenSpend: null })
  }

  const smokeProviderEnabled = isAiResultCacheSmokeProviderEnabled()
  if (smokeProviderEnabled) {
    const smoke = createSmokeAiResult({
      feature: 'survivor-ai',
      leagueId,
      route: '/api/leagues/[leagueId]/survivor/ai',
      input: cacheInputs,
    })
    const smokePayload = {
      deterministic: deterministicResponse,
      narrative: smoke.text,
      model: 'smoke-provider',
      type,
      tokenSpend: access.tokenSpend
        ? {
            ruleCode: access.ruleCode,
            tokenCost: access.tokenPreview?.tokenCost ?? null,
            balanceAfter: access.tokenSpend.balanceAfter,
            ledgerId: access.tokenSpend.id,
          }
        : null,
    }

    await writeAiResultCache({
      resultKey,
      inputHash,
      feature: 'survivor-ai',
      scopeType: 'league',
      scopeId: leagueId,
      provider: 'smoke-provider',
      inputJson: cacheInputs,
      resultJson: smokePayload,
      ttlMs: SURVIVOR_AI_CACHE_TTL_MS,
    })

    return NextResponse.json(smokePayload)
  }

  try {
    const { narrative, model } = await generateSurvivorAI(deterministic, type, userId)
    if (model === 'deterministic-fallback' || !narrative?.trim()) paidToolNotDelivered()
    const responsePayload = {
      deterministic: deterministicResponse,
      narrative,
      model,
      type,
      tokenSpend: access.tokenSpend
        ? {
            ruleCode: access.ruleCode,
            tokenCost: access.tokenPreview?.tokenCost ?? null,
            balanceAfter: access.tokenSpend.balanceAfter,
            ledgerId: access.tokenSpend.id,
          }
        : null,
    }

    writeAiResultCache({
      resultKey,
      inputHash,
      feature: 'survivor-ai',
      scopeType: 'league',
      scopeId: leagueId,
      provider: 'openai',
      model: model ?? 'gpt-4o',
      inputJson: cacheInputs,
      resultJson: responsePayload,
      ttlMs: SURVIVOR_AI_CACHE_TTL_MS,
    }).catch(() => undefined)

    return NextResponse.json(responsePayload)
  } catch (e) {
    console.error('[survivor/ai]', e)
    if (refundLedgerId) {
      await new TokenSpendService()
        .refundSpendByLedger({
          userId,
          spendLedgerId: refundLedgerId,
          refundRuleCode: 'feature_execution_failed',
          sourceType: 'survivor_ai_refund',
          sourceId: refundLedgerId,
          idempotencyKey: `refund:survivor_ai:${refundLedgerId}`,
          description: 'Auto refund after failed Survivor AI generation.',
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
