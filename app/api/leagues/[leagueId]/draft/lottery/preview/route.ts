/**
 * GET: Preview lottery odds (eligible teams, weights, percentages).
 * POST: Optional body with config override for preview.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { getDraftOrderModeAndLotteryConfig } from '@/lib/draft-lottery/lotteryConfigStorage'
import { previewLotteryOdds } from '@/lib/draft-lottery/WeightedDraftLotteryEngine'
import type { WeightedLotteryConfig } from '@/lib/draft-lottery/types'
import { legacyDraftLotteryRestriction } from '@/lib/draft-lottery/dynastyYearGuard'

export const dynamic = 'force-dynamic'

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

  const lotteryRestriction = await legacyDraftLotteryRestriction(leagueId)
  if (lotteryRestriction) return NextResponse.json({ error: lotteryRestriction }, { status: 403 })

  const { lotteryConfig } = await getDraftOrderModeAndLotteryConfig(leagueId)
  const config: WeightedLotteryConfig = { ...lotteryConfig, enabled: true }

  const result = await previewLotteryOdds(leagueId, config)
  if (!result) return NextResponse.json({ error: 'Could not load standings' }, { status: 500 })

  return NextResponse.json({
    eligible: result.eligible,
    playoffTeamCount: result.playoffTeamCount,
    message: result.message,
    config: {
      lotteryTeamCount: config.lotteryTeamCount,
      lotteryPickCount: config.lotteryPickCount,
      eligibilityMode: config.eligibilityMode,
      weightingMode: config.weightingMode,
    },
  })
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const lotteryRestriction = await legacyDraftLotteryRestriction(leagueId)
  if (lotteryRestriction) return NextResponse.json({ error: lotteryRestriction }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { lotteryConfig: configOverride } = await getDraftOrderModeAndLotteryConfig(leagueId)
  const merged: WeightedLotteryConfig = {
    ...configOverride,
    ...(body.lotteryTeamCount !== undefined && { lotteryTeamCount: Number(body.lotteryTeamCount) }),
    ...(body.lotteryPickCount !== undefined && { lotteryPickCount: Number(body.lotteryPickCount) }),
    ...(body.eligibilityMode !== undefined && { eligibilityMode: body.eligibilityMode }),
    ...(body.weightingMode !== undefined && { weightingMode: body.weightingMode }),
    ...(body.fallbackOrder !== undefined && { fallbackOrder: body.fallbackOrder }),
    ...(body.tiebreakMode !== undefined && { tiebreakMode: body.tiebreakMode }),
    enabled: true,
  }

  const result = await previewLotteryOdds(leagueId, merged)
  if (!result) return NextResponse.json({ error: 'Could not load standings' }, { status: 500 })

  return NextResponse.json({
    eligible: result.eligible,
    playoffTeamCount: result.playoffTeamCount,
    message: result.message,
    config: {
      lotteryTeamCount: merged.lotteryTeamCount,
      lotteryPickCount: merged.lotteryPickCount,
      eligibilityMode: merged.eligibilityMode,
      weightingMode: merged.weightingMode,
    },
  })
}
