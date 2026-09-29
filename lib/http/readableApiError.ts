/**
 * The sentence to show a person when an API call failed. PURE, client-safe.
 *
 * 🛑 RAW API STRINGS WERE REACHING USERS (2026-09-29 UI audit). Several screens printed a failed
 * response's `error` field as-is, and `error` is often a machine value rather than a sentence:
 * sign-up showed "GEO_BLOCKED" / "VPN_BLOCKED" / "PHONE_VERIFY_NOT_CONFIGURED", the trade finder
 * "Premium feature" / "Unauthorized" / "Missing leagueId" — while the same responses often carried
 * a readable `message` nobody displayed.
 *
 * Order: the response's `message`; else its `error` when that reads as a sentence; else the
 * caller's fallback. An ALL_CAPS_CODE, a bare HTTP word ("Unauthorized") or a field name is never
 * a sentence.
 */
const HTTP_WORDS = new Set(['unauthorized', 'forbidden', 'not found', 'bad request', 'internal server error'])

function isSentence(s: string): boolean {
  const t = s.trim()
  if (t.length < 3) return false
  if (/^[A-Z0-9_]+$/.test(t)) return false // MACHINE_CODE
  if (HTTP_WORDS.has(t.toLowerCase())) return false
  if (/^missing [a-z][A-Za-z0-9]*$/i.test(t)) return false // "Missing leagueId"
  return /\s/.test(t) // a sentence has at least two words
}

export function readableApiError(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    if (typeof b.message === 'string' && b.message.trim()) return b.message.trim()
    if (typeof b.error === 'string' && isSentence(b.error)) return b.error.trim()
  }
  return fallback
}
