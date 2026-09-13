/**
 * POST: Zombie AI tools (strategy, advice, recap). PROMPT 355.
 * Deterministic context first; AI narrates/advises only. No infection, legality, or movement decisions.
 * Gated by zombie_ai or ai_chat when subscription is enforced.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isZombieLeague } from '@/lib/zombie/ZombieLeagueConfig'
import { buildZombieAIContext } from '@/lib/zombie/ai/ZombieAIContext'
import type { ZombieAIType } from '@/lib/zombie/ai/ZombieAIContext'
import {
  buildZombieAiCacheContextSummary,
  generateZombieAI,
} from '@/lib/zombie/ai/ZombieAIService'
import { getZombieHordeSitOutStateForWeek } from '@/lib/zombie/ZombieHordeSitOutEngine'
import { resolveWhispererViewer } from '@/lib/zombie/whispererViewer'
import { redactZombieAIContext, withWhispererRoster } from '@/lib/zombie/whispererRedaction'
import {
  FeatureGateService,
  isFeatureGateAccessError,
} from '@/lib/subscription/FeatureGateService'
import {
  buildAiCacheKey,
  createSmokeAiResult,
  isAiResultCacheSmokeProviderEnabled,
  readAiResultCache,
  writeAiResultCache,
} from '@/lib/ai-result-cache'

export const dynamic = 'force-dynamic'
const ZOMBIE_AI_CACHE_TTL_MS = 30 * 60 * 1000

const VALID_TYPES: ZombieAIType[] = [
  'survival_strategy',
  'zombie_strategy',
  'whisperer_strategy',
  'serum_timing_advice',
  'weapon_timing_advice',
  'ambush_planning_advice',
  'stay_alive_framing',
  'lineup_zombie_context',
  'weekly_zombie_recap',
  'most_at_risk',
  'chompin_block_explanation',
  'serum_weapon_holders_commentary',
  'whisperer_pressure_summary',
  'commissioner_review_summary',
]

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = new FeatureGateService()
  try {
    await gate.assertUserHasFeature(userId, 'zombie_ai')
  } catch (error) {
    if (isFeatureGateAccessError(error)) {
      return NextResponse.json(
        {
          error: 'Premium feature',
          message: error.message,
          code: error.code,
          requiredPlan: error.requiredPlan,
          upgradePath: error.upgradePath,
        },
        { status: error.statusCode }
      )
    }
    throw error
  }

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isZombie = await isZombieLeague(leagueId)
  if (!isZombie) return NextResponse.json({ error: 'Not a zombie league' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const type = (typeof body.type === 'string' ? body.type : 'survival_strategy') as ZombieAIType
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Invalid type', validTypes: VALID_TYPES }, { status: 400 })
  }

  const week = Math.max(1, parseInt(String(body.week ?? 1), 10) || 1)

  const deterministic = await buildZombieAIContext({ leagueId, week, userId })
  if (!deterministic) {
    return NextResponse.json({ error: 'Could not build context' }, { status: 500 })
  }

  // The Whisperer's identity reaches the response, the cache key and the model prompt only for a
  // viewer allowed to know it. Everything below reads `context`, never `deterministic`.
  const viewer = await resolveWhispererViewer(leagueId, userId)
  const context = viewer.canSee
    ? deterministic
    : redactZombieAIContext(deterministic, withWhispererRoster(viewer.identity, deterministic.whispererRosterId))

  const deterministicResponse = {
    leagueId: context.leagueId,
    sport: context.sport,
    week: context.week,
    config: context.config,
    whispererRosterId: context.whispererRosterId,
    whispererHidden: context.whispererHidden === true,
    survivors: context.survivors,
    zombies: context.zombies,
    movementWatch: context.movementWatch,
    rosterDisplayNames: context.rosterDisplayNames,
    myRosterId: context.myRosterId,
    myResources: context.myResources,
    chompinBlockCandidates: context.chompinBlockCandidates,
    collusionFlags: context.collusionFlags,
    dangerousDropFlags: context.dangerousDropFlags,
  }

  const sitOutState = await getZombieHordeSitOutStateForWeek(leagueId, week, userId)
  const sitOutSummary = {
    pendingUserIds: sitOutState.pending.map((row) => row.userId).sort(),
    acceptedUserIds: sitOutState.accepted.map((row) => row.userId).sort(),
    declinedUserIds: sitOutState.declined.map((row) => row.userId).sort(),
    myPendingSitOutId: sitOutState.myPending?.id ?? null,
  }

  const cacheInputs = {
    leagueId,
    type,
    week,
    userId,
    myRosterId: context.myRosterId,
    whispererRosterId: context.whispererRosterId,
    survivorRosterIds: context.survivors.slice().sort(),
    zombieRosterIds: context.zombies.slice().sort(),
    contextSummary: buildZombieAiCacheContextSummary(context),
    sitOutSummary,
  }
  const { resultKey, inputHash } = buildAiCacheKey('zombie-ai', cacheInputs)
  const cached = await readAiResultCache(resultKey)
  if (cached?.resultJson && typeof cached.resultJson === 'object') {
    return NextResponse.json(cached.resultJson)
  }

  const smokeProviderEnabled = isAiResultCacheSmokeProviderEnabled()
  if (smokeProviderEnabled) {
    const smoke = createSmokeAiResult({
      feature: 'zombie-ai',
      leagueId,
      route: '/api/leagues/[leagueId]/zombie/ai',
      input: cacheInputs,
    })
    const smokePayload = {
      deterministic: deterministicResponse,
      narrative: smoke.text,
      model: 'smoke-provider',
      type,
    }

    await writeAiResultCache({
      resultKey,
      inputHash,
      feature: 'zombie-ai',
      scopeType: 'league',
      scopeId: leagueId,
      provider: 'smoke-provider',
      model: 'smoke-provider',
      inputJson: cacheInputs,
      resultJson: smokePayload,
      ttlMs: ZOMBIE_AI_CACHE_TTL_MS,
    })

    return NextResponse.json(smokePayload)
  }

  try {
    const { narrative, model } = await generateZombieAI(context, type, userId)
    const responsePayload = {
      deterministic: deterministicResponse,
      narrative,
      model,
      type,
    }

    writeAiResultCache({
      resultKey,
      inputHash,
      feature: 'zombie-ai',
      scopeType: 'league',
      scopeId: leagueId,
      provider: 'openai',
      model: model ?? 'gpt-4o-mini',
      inputJson: cacheInputs,
      resultJson: responsePayload,
      ttlMs: ZOMBIE_AI_CACHE_TTL_MS,
    }).catch(() => undefined)

    return NextResponse.json(responsePayload)
  } catch (e) {
    console.error('[zombie/ai]', e)
    return NextResponse.json(
      { error: 'AI generation failed', message: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
