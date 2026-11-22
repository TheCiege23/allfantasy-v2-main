import { NextResponse } from 'next/server'
import { DraftWorker } from '@/lib/workers/draft-worker'
import { previewDraftLottery } from '@/lib/workers/lottery-engine'
import { requireDraftRouteUser, requireLiveDraftAccess } from '@/lib/draft/api-route-helpers'
import { getDraftOrderModeAndLotteryConfig } from '@/lib/draft-lottery/lotteryConfigStorage'
import { isSameSlotOrder } from '@/lib/draft-lottery/lotteryView'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ draftId: string }> }
) {
  try {
    const userId = await requireDraftRouteUser()
    const { draftId } = await ctx.params
    await requireLiveDraftAccess(draftId, userId)

    const worker = new DraftWorker({ viewerUserId: userId })
    const state = await worker.initializeDraft(draftId)
    const lotteryPreview = state.routeType === 'lottery'
      ? await previewDraftLottery(draftId).catch(() => null)
      : null

    // The lottery page needs the rules ("drawn for picks 1–6") and to know whether the commissioner
    // already locked an order in — otherwise a revisit offers to run the lottery again. Locked =
    // the session's draft order IS the last stored result (lottery-engine writes both on finalize).
    let lottery: { pickCount: number; lastResult: unknown; locked: boolean } | null = null
    if (state.routeType === 'lottery') {
      const { lotteryConfig, lotteryLastResult } = await getDraftOrderModeAndLotteryConfig(state.leagueId).catch(() => ({
        lotteryConfig: null,
        lotteryLastResult: null,
      }))
      const eligibleCount = lotteryPreview?.eligible.length ?? 0
      const locked = isSameSlotOrder(state.slotOrder, lotteryLastResult?.slotOrder)
      lottery = {
        pickCount: Math.min(lotteryConfig?.lotteryPickCount ?? eligibleCount, eligibleCount || Infinity),
        lastResult: locked ? lotteryLastResult : null,
        locked,
      }
    }

    return NextResponse.json({
      ok: true,
      state,
      lotteryPreview,
      lottery,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load draft state'
    const status =
      message === 'Unauthorized' ? 401 :
      message === 'Forbidden' ? 403 :
      message === 'Draft not found' ? 404 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
