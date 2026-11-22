import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"

export const LS_MAX_REQUEST_BYTES = 2 * 1024 * 1024
export const LS_SIGNATURE_WINDOW_SECONDS = 300
export const LS_BOT_ADDRESS = "allfantasysportsapp@gmail.com"

export function getLeagueSafeInboundConfig() {
  const secret = process.env.LS_INBOUND_SECRET ?? ""
  const domains = (process.env.LS_SENDER_DOMAINS ?? "")
    .split(",").map((domain) => domain.trim().toLowerCase()).filter(Boolean)
  const validDomain = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/
  if (Buffer.byteLength(secret, "utf8") < 32 || domains.length === 0 ||
      domains.some((domain) => !validDomain.test(domain))) return null
  return { secret, domains: [...new Set(domains)] }
}

/** Sign the exact UTF-8 HTTP body, before JSON decoding or normalization. */
export function verifyLeagueSafeSignature(
  body: Buffer,
  timestamp: string | null,
  signature: string | null,
  secret: string,
  now = Date.now(),
): boolean {
  if (!timestamp || !/^\d{10}$/.test(timestamp) ||
      Math.abs(Math.floor(now / 1000) - Number(timestamp)) > LS_SIGNATURE_WINDOW_SECONDS ||
      !signature || !/^v1=[a-f0-9]{64}$/i.test(signature)) return false
  const expected = createHmac("sha256", secret).update(timestamp + ".").update(body).digest()
  const supplied = Buffer.from(signature.slice(3), "hex")
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

export class InboundBodyTooLarge extends Error {}

/** Do not trust Content-Length: enforce the limit while reading chunked requests too. */
export async function readLeagueSafeRequestBody(request: Request): Promise<Buffer> {
  const length = request.headers.get("content-length")
  if (length && Number(length) > LS_MAX_REQUEST_BYTES) throw new InboundBodyTooLarge()
  const reader = request.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks: Buffer[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > LS_MAX_REQUEST_BYTES) {
        await reader.cancel()
        throw new InboundBodyTooLarge()
      }
      chunks.push(Buffer.from(value))
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks, size)
}
