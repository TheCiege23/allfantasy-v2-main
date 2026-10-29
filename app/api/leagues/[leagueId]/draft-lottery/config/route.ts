/**
 * GET: Current draft order mode + weighted lottery config (league members).
 * PUT: Update lottery config (commissioner only, year 2+ dynasty guard on mode changes).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isCommissioner } from '@/lib/commissioner/permissions'
import {
  getDraftOrderModeAndLotteryConfig,
  setDraftOrderModeAndLotteryConfig,
} from '@/lib/draft-lottery/lotteryConfigStorage'
import { checkDynastyLotteryEligibility } from '@/lib/draft-lottery/dynastyYearGuard'
import type { DraftOrderMode, WeightedLotteryConfig } from '@/lib/draft-lottery/types'

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

  const [lotteryEligibility, order] = await Promise.all([
    checkDynastyLotteryEligibility(leagueId),
    getDraftOrderModeAndLotteryConfig(leagueId),
  ])

  return NextResponse.json({
    lotteryEligibility: {
      eligible: lotteryEligibility.eligible,
      reason: lotteryEligibility.reason,
      isStartupLeague: lotteryEligibility.isStartupLeague,
    },
    draftOrderMode: order.draftOrderMode,
    lotteryConfig: order.lotteryConfig,
    lotteryLastSeed: order.lotteryLastSeed,
    lotteryLastRunAt: order.lotteryLastRunAt,
    lotteryLastResult: order.lotteryLastResult,
  })
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const commissioner = await isCommissioner(leagueId, userId)
  if (!commissioner) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const lotteryEligibility = await checkDynastyLotteryEligibility(leagueId)
  if (!lotteryEligibility.eligible) {
    return NextResponse.json({ error: lotteryEligibility.reason }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    draftOrderMode?: DraftOrderMode
    lotteryConfig?: Partial<WeightedLotteryConfig>
  }

  // The rules as members read them, before the write — for the league home's "What changed" card.
  // Loaded lazily and best-effort (lib/league-rules-explainer/loadDraftRules.ts): it never fails the save.
  const rules = await import('@/lib/league-rules-explainer/loadDraftRules').catch(() => null)
  const [draftBefore, lotteryBefore] = rules
    ? await Promise.all([rules.loadDraftRulesSafe(leagueId), rules.loadRookieLotteryRulesSafe(leagueId)]).catch(() => [null, null] as const)
    : ([null, null] as const)

  await setDraftOrderModeAndLotteryConfig(leagueId, {
    ...(body.draftOrderMode !== undefined ? { draftOrderMode: body.draftOrderMode } : {}),
    ...(body.lotteryConfig !== undefined ? { lotteryConfig: body.lotteryConfig } : {}),
  })

  /*
   * ONE silent event (no push / email) for the save. The two halves never name the same key:
   *   draftOrderMethod     the main draft (Draft section); none once that draft is complete
   *   rookieDraftLottery   the lottery's own settings (Dynasty section, beside the rookie order); kept
   *                        after a completed draft, because the config governs the NEXT draw
   */
  if (rules) {
    try {
      const [draftAfter, lotteryAfter] = await Promise.all([rules.loadDraftRulesSafe(leagueId), rules.loadRookieLotteryRulesSafe(leagueId)])
      const { publishRuleChangesEvent } = await import('@/lib/league-rules-explainer/publishRuleChanges')
      await publishRuleChangesEvent({
        leagueId,
        actorUserId: userId,
        section: 'draft-lottery',
        changes: [...rules.draftRuleChanges(draftBefore, draftAfter), ...rules.rookieLotteryRuleChanges(lotteryBefore, lotteryAfter)],
      })
    } catch (e) {
      console.warn('[draft-lottery/config PUT] change card', e instanceof Error ? e.message : 'unknown error')
    }
  }

  const next = await getDraftOrderModeAndLotteryConfig(leagueId)
  return NextResponse.json({ ok: true, ...next })
}
