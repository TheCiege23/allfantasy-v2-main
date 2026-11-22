/**
 * Dynasty Intelligence API (PROMPT 137).
 * GET ?sport=NFL&position=WR&age=25&baseValue=5000&playerId=...
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'
import {
  getPlayerDynastyIntelligence,
  getDynastyIntelligenceSupportedSports,
} from '@/lib/dynasty-intelligence'
import { getDynastyAIInsight } from '@/lib/dynasty-intelligence/DynastyIntelligenceAI'
import { isSupportedSport, normalizeToSupportedSport } from '@/lib/sport-scope'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const sport = searchParams?.get('sport')?.trim() ?? undefined
    const position = searchParams?.get('position')?.trim() ?? undefined
    const ageParam = searchParams?.get('age')
    const age = ageParam != null ? parseInt(ageParam, 10) : undefined
    const baseValueParam = searchParams?.get('baseValue')
    const baseValue = baseValueParam != null ? parseFloat(baseValueParam) : undefined
    const playerId = searchParams?.get('playerId')?.trim() ?? undefined
    const isSuperFlex =
      searchParams?.get('isSuperFlex') === '1' || searchParams?.get('isSuperFlex') === 'true'
    const isTightEndPremium =
      searchParams?.get('isTightEndPremium') === '1' ||
      searchParams?.get('isTightEndPremium') === 'true'
    const includeAI = searchParams?.get('ai') === '1' || searchParams?.get('ai') === 'true'

    if (!sport || !isSupportedSport(sport)) {
      return NextResponse.json(
        {
          error: 'Invalid or missing sport',
          supported: getDynastyIntelligenceSupportedSports(),
        },
        { status: 400 }
      )
    }

    const result = await getPlayerDynastyIntelligence({
      sport: normalizeToSupportedSport(sport),
      position,
      age: Number.isFinite(age) ? age! : undefined,
      baseValue: Number.isFinite(baseValue) ? baseValue! : undefined,
      playerId,
      isSuperFlex,
      isTightEndPremium,
    })

    if (includeAI) {
      /*
       * ⚠ `ai=1` CALLED DEEPSEEK / OPENAI / XAI WITH NO SIGN-IN AT ALL — anyone on the internet could run
       * it. The AI insight is the War Room's "Dynasty Projections" (`war_room_dynasty_projections`), so it
       * now needs a signed-in user on that plan. The deterministic numbers above stay as they were.
       */
      const session = (await getServerSession(authOptions as never).catch(() => null)) as { user?: { id?: string; email?: string | null } } | null
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: 'Unauthorized', code: 'sign_in_required' }, { status: 401 })
      const gate = await requireFeatureEntitlement({ userId, userEmail: session?.user?.email ?? null, featureId: 'war_room_dynasty_projections' })
      if (!gate.ok) return gate.response
      const insight = await getDynastyAIInsight(result)
      return NextResponse.json({ data: result, insight })
    }
    return NextResponse.json({ data: result })
  } catch (e) {
    console.error('[dynasty-intelligence]', e)
    return NextResponse.json(
      { error: 'Failed to compute dynasty intelligence' },
      { status: 500 }
    )
  }
}

