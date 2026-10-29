import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

const TTL = 10 * 60_000
const DOMAIN = 'af-paid-tool-quote-v1:'
export type PaidToolQuoteInput = { userId: string; requestId: string; fingerprint: string; ruleCode: string; tokenCost: number }
type Dependencies = { secret?: string; now?: () => number }
function key(deps: Dependencies): string {
  const value = deps.secret ?? process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET
  if (!value) throw new Error('Token price confirmation is unavailable')
  return value
}
function sign(body: string, secret: string) { return createHmac('sha256', secret).update(DOMAIN + body).digest() }
export function issuePaidToolQuote(input: PaidToolQuoteInput, deps: Dependencies = {}) {
  if (!Number.isSafeInteger(input.tokenCost) || input.tokenCost < 0) throw new Error('Invalid token price')
  const expires = (deps.now?.() ?? Date.now()) + TTL
  const body = Buffer.from(JSON.stringify({ version: 1, ...input, expires })).toString('base64url')
  return { tokenQuote: body + '.' + sign(body, key(deps)).toString('base64url'), quoteExpiresAt: new Date(expires).toISOString() }
}
export function verifyPaidToolQuote(quote: unknown, expected: PaidToolQuoteInput, deps: Dependencies = {}): boolean {
  if (typeof quote !== 'string' || quote.length > 2048) return false
  const parts = quote.split('.')
  if (parts.length !== 2) return false
  const actual = Buffer.from(parts[1], 'base64url'), wanted = sign(parts[0], key(deps))
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return false
  try {
    const value = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    const now = deps.now?.() ?? Date.now()
    return value.version === 1 && Object.entries(expected).every(([k, v]) => value[k] === v) &&
      Number.isSafeInteger(value.expires) && value.expires > now && value.expires <= now + TTL
  } catch { return false }
}
