import { promisify } from 'node:util'
import { gzip, gzipSync } from 'node:zlib'

const compress = promisify(gzip)
const COMPRESSED_BOARD_MIN_CHARS = 64_000

export async function prepareDraftSessionResponse({
  session,
  ...shared
}: {
  leagueId: string
  session: Record<string, unknown>
  [key: string]: unknown
}) {
  // The open session object gets the viewer fields when the request has resolved them.
  const prefix = JSON.stringify(shared).slice(0, -1) + ',"session":' + JSON.stringify(session).slice(0, -1)
  const compressedPrefix = prefix.length >= COMPRESSED_BOARD_MIN_CHARS
    ? await compress(prefix, { level: 4 })
    : null

  return (viewer: Record<string, unknown>, acceptEncoding: string | null) => {
    const viewerJson = JSON.stringify(viewer)
    const separator = prefix.endsWith('{') ? '' : ','
    const suffix = (viewerJson === '{}' ? '' : separator + viewerJson.slice(1, -1)) + '}}'
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      Vary: 'Accept-Encoding',
    }
    const acceptGzip = acceptEncoding?.split(',').some(encoding => {
      const [name, ...parameters] = encoding.trim().toLowerCase().split(';')
      const quality = parameters.map(parameter => parameter.trim()).find(parameter => parameter.startsWith('q='))
      return name.trim() === 'gzip' && (quality == null || Number(quality.slice(2)) > 0)
    })
    if (!compressedPrefix || !acceptGzip) return new Response(prefix + suffix, { headers })

    // RFC 1952 allows adjacent gzip members. Every viewer shares the expensive board member.
    const compressedSuffix = gzipSync(suffix)
    const body = new Uint8Array(compressedPrefix.byteLength + compressedSuffix.byteLength)
    body.set(compressedPrefix)
    body.set(compressedSuffix, compressedPrefix.byteLength)
    headers['Content-Encoding'] = 'gzip'
    return new Response(body, { headers })
  }
}
