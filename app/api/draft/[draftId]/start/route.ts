import { NextResponse } from 'next/server'
import { DraftWorker } from '@/lib/workers/draft-worker'
import { requireDraftRouteUser, requireLiveDraftAccess } from '@/lib/draft/api-route-helpers'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ draftId: string }> }
) {
  try {
    const userId = await requireDraftRouteUser()
    const { draftId } = await ctx.params
    const { context } = await requireLiveDraftAccess(draftId, userId)
    if (!context.isCommissioner) {
      return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
    }

    const worker = new DraftWorker({ viewerUserId: userId })
    await worker.startDraft(draftId)
    return NextResponse.json({ ok: true, state: await worker.initializeDraft(draftId) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start draft'
    const status =
      message === 'Unauthorized' ? 401 :
      message === 'Forbidden' ? 403 :
      message === 'Draft not found' ? 404 :
      message.startsWith('SURVIVOR_CAST_INCOMPLETE:') ? 409 : 500
    return NextResponse.json(message.startsWith('SURVIVOR_CAST_INCOMPLETE:')
      ? { code: 'SURVIVOR_CAST_INCOMPLETE', error: message.slice('SURVIVOR_CAST_INCOMPLETE:'.length) }
      : { error: message }, { status })
  }
}
