import { promisify } from 'node:util'
import { gzip } from 'node:zlib'

const compress = promisify(gzip)

export async function prepareDraftSessionResponse(
  { session, ...shared }: { leagueId: string; session: Record<string, unknown>; [key: string]: unknown },
  compressPicks = false,
) {
  if (compressPicks && Array.isArray(session.picks) && session.picks.length >= 256) {
    const { picks, ...metadata } = session
    const encoded = await compress(JSON.stringify(picks), { level: 4 })
    session = { ...metadata, picksGzip: encoded.toString('base64') }
  }
  // The open session object gets the viewer fields when the request has resolved them.
  const prefix = JSON.stringify(shared).slice(0, -1) + ',"session":' + JSON.stringify(session).slice(0, -1)
  const separator = prefix.endsWith('{') ? '' : ','
  const board = new TextEncoder().encode(prefix)

  return (viewer: Record<string, unknown>) => {
    const viewerJson = JSON.stringify(viewer)
    const suffix = (viewerJson === '{}' ? '' : separator + viewerJson.slice(1, -1)) + '}}'
    // Next owns HTTP framing. The room data is encoded once per shared snapshot.
    const tail = new TextEncoder().encode(suffix)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(board)
        controller.enqueue(tail)
        controller.close()
      },
    })
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'private, no-store',
      },
    })
  }
}
