import { NextRequest, NextResponse } from 'next/server'
import { DraftWorker } from '@/lib/workers/draft-worker'
import { requireDraftRouteUser, requireLiveDraftAccess } from '@/lib/draft/api-route-helpers'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ draftId: string }> }
) {
  try {
    const userId = await requireDraftRouteUser()
    const { draftId } = await ctx.params
    const { currentUserRosterId } = await requireLiveDraftAccess(draftId, userId)
    const teamId = String(req.nextUrl.searchParams?.get('teamId') ?? currentUserRosterId ?? '').trim()
    const picksAhead = Math.max(1, Number(req.nextUrl.searchParams?.get('picksAhead') ?? 3))
    if (!teamId) {
      return NextResponse.json({ error: 'teamId is required' }, { status: 400 })
    }

    const worker = new DraftWorker({ viewerUserId: userId })
    const recommendation = await worker.getAIRecommendation(draftId, teamId)
    const lookahead = await worker.runLookahead(draftId, teamId, picksAhead)
    return NextResponse.json({ ok: true, recommendation, lookahead })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load Chimmy queue'
    const status =
      message === 'Unauthorized' ? 401 :
      message === 'Forbidden' ? 403 :
      message === 'Draft not found' ? 404 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
