import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

const TTL_MS = 10 * 60_000
const DOMAIN = 'chimmy-analysis-quote-v1:'
type QuoteInput = { userId: string; requestId: string; fingerprint: string; tokenCost: number; access: 'daily_answer' | 'tokens' }
type QuoteDeps = { secret?: string; now?: () => number }
function secret(deps: QuoteDeps): string {
  const value = deps.secret ?? process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET
  if (!value) throw new Error('Analysis price confirmation is unavailable')
  return value
}
function signature(body: string, key: string): Buffer {
  return createHmac('sha256', key).update(DOMAIN + body).digest()
}
export function issueAnalysisQuote(input: QuoteInput, deps: QuoteDeps = {}): { quote: string; expiresAt: string } {
  if (!Number.isSafeInteger(input.tokenCost) || input.tokenCost < 0) throw new Error('Invalid analysis price')
  const expires = (deps.now?.() ?? Date.now()) + TTL_MS
  const body = Buffer.from(JSON.stringify({ version: 1, ...input, ruleCode: 'ai_chimmy_chat_message', expires })).toString('base64url')
  return { quote: body + '.' + signature(body, secret(deps)).toString('base64url'), expiresAt: new Date(expires).toISOString() }
}
export function verifyAnalysisQuote(quote: string | undefined, expected: QuoteInput, deps: QuoteDeps = {}): boolean {
  if (!quote || quote.length > 2048) return false
  const parts = quote.split('.')
  if (parts.length !== 2) return false
  const actual = Buffer.from(parts[1], 'base64url')
  const wanted = signature(parts[0], secret(deps))
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return false
  try {
    const value = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    const now = deps.now?.() ?? Date.now()
    return value.version === 1 && value.ruleCode === 'ai_chimmy_chat_message' && value.userId === expected.userId &&
      value.requestId === expected.requestId && value.fingerprint === expected.fingerprint && value.tokenCost === expected.tokenCost && value.access === expected.access &&
      Number.isSafeInteger(value.expires) && value.expires > now && value.expires <= now + TTL_MS
  } catch { return false }
}
