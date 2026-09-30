import { requireDraftRouteUser, requireLiveDraftAccess } from '@/lib/draft/api-route-helpers'
import { draftStreamStore } from '@/lib/draft/draft-stream-store'
import { DraftWorker } from '@/lib/workers/draft-worker'
import { recordEngineTelemetrySample } from '@/lib/analytics/recordAnalyticsEvent'
import { ENGINE } from '@/lib/analytics/eventNames'

export const dynamic = 'force-dynamic'

function encodeSse(event: string, payload: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ draftId: string }> }
) {
  try {
    const userId = await requireDraftRouteUser()
    const { draftId } = await ctx.params
    await requireLiveDraftAccess(draftId, userId)

    // Sampled: track SSE stream connections (equivalent to Pusher auth).
    // Spikes here signal reconnect storms — e.g. all clients reconnecting
    // after a server restart or Pusher channel drop.
    recordEngineTelemetrySample(ENGINE.PUSHER_AUTH, {
      meta: { draftId, userId },
    })

    const worker = new DraftWorker({ viewerUserId: userId })
    const encoder = new TextEncoder()

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, payload: unknown) => {
          controller.enqueue(encoder.encode(encodeSse(event, payload)))
        }

        const initial = draftStreamStore.getLatestState(draftId) ?? (await worker.initializeDraft(draftId))
        send('draft_state', initial)

        const unsubscribe = draftStreamStore.subscribe(draftId, (event) => {
          send(event.type, event.payload)
        })

        const keepAlive = setInterval(() => {
          send('connected', { draftId, at: new Date().toISOString() })
        }, 15_000)

        req.signal.addEventListener('abort', () => {
          clearInterval(keepAlive)
          unsubscribe()
          try {
            controller.close()
          } catch {
            // stream already closed
          }
        }, { once: true })
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to open stream'
    const status =
      message === 'Unauthorized' ? 401 :
      message === 'Forbidden' ? 403 :
      message === 'Draft not found' ? 404 : 500
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
}
