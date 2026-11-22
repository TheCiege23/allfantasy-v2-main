import { promisify } from 'node:util'
import * as zlib from 'node:zlib'

const compress = promisify(zlib.deflateRaw)
const COMPRESSED_BOARD_MIN_CHARS = 64_000
const GZIP_HEADER = Uint8Array.of(0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 255)

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
  const prefixBytes = prefix.length >= COMPRESSED_BOARD_MIN_CHARS && typeof zlib.crc32 === 'function'
    ? Buffer.from(prefix)
    : null
  const compressedPrefix = prefixBytes
    ? await compress(prefixBytes, { level: 4, finishFlush: zlib.constants.Z_SYNC_FLUSH })
    : null
  const prefixChecksum = prefixBytes ? zlib.crc32(prefixBytes) : 0

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
    if (!prefixBytes || !compressedPrefix || !acceptGzip) return new Response(prefix + suffix, { headers })

    // The flushed board ends at a byte boundary without ending the DEFLATE stream.
    // Append independent final blocks and one checksum so browsers receive a single gzip member.
    const suffixBytes = Buffer.from(suffix)
    const compressedSuffix = zlib.deflateRawSync(suffixBytes)
    const footer = Buffer.alloc(8)
    footer.writeUInt32LE(zlib.crc32(suffixBytes, prefixChecksum))
    footer.writeUInt32LE((prefixBytes.byteLength + suffixBytes.byteLength) >>> 0, 4)
    const body = new Uint8Array(GZIP_HEADER.byteLength + compressedPrefix.byteLength + compressedSuffix.byteLength + footer.byteLength)
    body.set(GZIP_HEADER)
    body.set(compressedPrefix, GZIP_HEADER.byteLength)
    body.set(compressedSuffix, GZIP_HEADER.byteLength + compressedPrefix.byteLength)
    body.set(footer, body.byteLength - footer.byteLength)
    headers['Content-Encoding'] = 'gzip'
    headers['Content-Length'] = String(body.byteLength)
    return new Response(body, { headers })
  }
}
