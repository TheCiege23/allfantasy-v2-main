/**
 * POST: Salary Cap AI — strategy and explanation only. Deterministic data returned first; AI explains.
 * PROMPT 341: No AI for cap legality, expiration, bid legality, lottery, or bestball scoring.
 * Gated by entitlement (salary_cap_ai or ai_chat when subscription is enforced).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isSalaryCapLeague } from '@/lib/salary-cap/SalaryCapLeagueConfig'
import { buildSalaryCapAIContext } from '@/lib/salary-cap/ai/SalaryCapAIContext'
import { generateSalaryCapAI } from '@/lib/salary-cap/ai/SalaryCapAIService'
import type { SalaryCapAIContextType } from '@/lib/salary-cap/ai/SalaryCapAIContext'
import {
  FeatureGateService,
  isFeatureGateAccessError,
} from '@/lib/subscription/FeatureGateService'

export const dynamic = 'force-dynamic'

const VALID_TYPES: SalaryCapAIContextType[] = [
  'startup_auction',
  'cap_health',
  'extension_tag',
  'trade_cap',
  'bestball',
  'offseason_planning',
  'orphan_takeover',
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
    await gate.assertUserHasFeature(userId, 'salary_cap_ai')
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

  const isCap = await isSalaryCapLeague(leagueId)
  if (!isCap) return NextResponse.json({ error: 'Not a salary cap league' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const type = (body.type ?? 'cap_health') as SalaryCapAIContextType
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Invalid type', validTypes: VALID_TYPES }, { status: 400 })
  }

  const deterministic = await buildSalaryCapAIContext({ leagueId, userId, type })
  if (!deterministic) {
    return NextResponse.json({ error: 'Could not build context' }, { status: 500 })
  }

  try {
    const { explanation, model } = await generateSalaryCapAI(deterministic, type, userId)
    return NextResponse.json({
      deterministic: {
        leagueId: deterministic.leagueId,
        sport: deterministic.sport,
        mode: deterministic.mode,
        capYear: deterministic.capYear,
        userRosterId: deterministic.userRosterId,
        config: deterministic.config,
        ledger: deterministic.ledger,
        futureProjection: deterministic.futureProjection,
        contractsCount: deterministic.contracts.length,
        expiringCount: deterministic.expiringCount,
        extensionCandidatesCount: deterministic.extensionCandidatesCount,
        tagCandidatesCount: deterministic.tagCandidatesCount,
        deadMoneyTotal: deterministic.deadMoneyTotal,
        rookieContractCount: deterministic.rookieContractCount,
        recentEventsCount: deterministic.recentEvents.length,
        lottery: deterministic.lottery,
      },
      explanation,
      model,
      type,
    })
  } catch (e) {
    console.error('[salary-cap/ai]', e)
    return NextResponse.json(
      { error: 'Chimmy generation failed', message: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
