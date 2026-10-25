/**
 * POST: Guillotine AI — strategy and explanation only. Deterministic data returned first; AI explains.
 * PROMPT 334: No AI for elimination, standings, tiebreak, or waiver execution.
 * Gated by entitlement (guillotine_ai or ai_chat when subscription is enforced).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isGuillotineLeague } from '@/lib/guillotine/GuillotineLeagueConfig'
import { buildGuillotineAIContext } from '@/lib/guillotine/ai/GuillotineAIContext'
import { generateGuillotineAI } from '@/lib/guillotine/ai/GuillotineAIService'
import { hasGuillotineAiRecapPlan, postAiGuillotineRecap } from '@/lib/guillotine/weeklyRecap'
import { isCommissioner } from '@/lib/commissioner/permissions'
import type { GuillotineAIType } from '@/lib/guillotine/ai/GuillotineAIService'
import {
  FeatureGateService,
  isFeatureGateAccessError,
} from '@/lib/subscription/FeatureGateService'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  // The commissioner's recap post comes with AF Pro OR AF Commissioner (owner's decision, 2026-10-25);
  // every other Guilly AI request stays an AF Pro feature.
  const recapPost = body?.type === 'recap' && body?.postToChat === true
  const gate = new FeatureGateService()
  try {
    if (!recapPost || !(await hasGuillotineAiRecapPlan(userId))) await gate.assertUserHasFeature(userId, 'guillotine_ai')
  } catch (error) {
    if (isFeatureGateAccessError(error)) {
      return NextResponse.json(
        {
          error: 'Premium feature',
          message: recapPost ? 'Chimmy recaps come with AF Pro or AF Commissioner.' : error.message,
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

  const isGuillotine = await isGuillotineLeague(leagueId)
  if (!isGuillotine) return NextResponse.json({ error: 'Not a Guilly league' }, { status: 404 })

  const type = (body.type ?? 'survival') as GuillotineAIType
  const validTypes: GuillotineAIType[] = ['draft', 'survival', 'waiver', 'recap', 'orphan']
  if (!validTypes.includes(type)) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  }

  // Commissioner-requested weekly recap, posted to league chat (lib/guillotine/weeklyRecap.ts).
  // User-initiated by design: AI generation is never cron-seeded here (scripts/cron-tier.mjs).
  if (type === 'recap' && body.postToChat === true) {
    if (!(await isCommissioner(leagueId, userId).catch(() => false))) {
      return NextResponse.json({ error: 'Only the commissioner can post the league recap.' }, { status: 403 })
    }
    const requestedWeek = body.week == null ? null : parseInt(String(body.week), 10)
    try {
      const posted = await postAiGuillotineRecap({ leagueId, userId, week: Number.isFinite(requestedWeek) ? requestedWeek : null })
      if (!posted.ok) return NextResponse.json({ error: posted.error }, { status: posted.status })
      return NextResponse.json(posted)
    } catch (e) {
      console.error('[guillotine/ai recap]', e instanceof Error ? e.message : 'unknown error')
      return NextResponse.json({ error: 'Could not post the recap' }, { status: 500 })
    }
  }

  const weekOrPeriod = Math.max(1, parseInt(String(body.week ?? body.weekOrPeriod ?? 1), 10) || 1)
  const userRosterId = body.userRosterId ?? undefined

  const deterministic = await buildGuillotineAIContext({
    leagueId,
    weekOrPeriod,
    type,
    userRosterId,
  })
  if (!deterministic) {
    return NextResponse.json({ error: 'Could not build context' }, { status: 500 })
  }

  try {
    const { explanation, model } = await generateGuillotineAI(deterministic, type, userId)
    return NextResponse.json({
      deterministic: {
        leagueId: deterministic.leagueId,
        sport: deterministic.sport,
        weekOrPeriod: deterministic.weekOrPeriod,
        survivalStandings: deterministic.survivalStandings,
        dangerTiers: deterministic.dangerTiers,
        recentChopEvents: deterministic.recentChopEvents,
        choppedThisWeek: deterministic.choppedThisWeek,
        config: deterministic.config,
        releasedPlayerIds: deterministic.releasedPlayerIds,
      },
      explanation,
      model,
      type,
    })
  } catch (e) {
    console.error('[guillotine/ai]', e)
    return NextResponse.json(
      { error: 'AI generation failed', message: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
