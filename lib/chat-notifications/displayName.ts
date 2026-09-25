/**
 * The name we put in front of another person — a push title, an email subject, a text, a trade card.
 *
 * ⚠ NEVER AN EMAIL ADDRESS OR A PHONE NUMBER. The chat service falls back to `sender.email` when a
 * user has no display name or username (`createPlatformThreadMessage`), which is tolerable inside a
 * conversation the two people share and is NOT tolerable on somebody's lock screen, in an email
 * subject a mail provider indexes, or in a text. Some accounts also carry an address or a number AS
 * their display name, because a signup form copied it there. Both shapes are rejected here and the
 * next candidate is tried.
 */

const EMAIL_SHAPE = /[^\s@]+@[^\s@]+\.[^\s@]+/
// Seven or more digits once spaces, dots, dashes, parens and a leading + are ignored.
const PHONE_SHAPE = /^\+?[\d\s().-]{7,}$/

export function isContactShaped(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  if (EMAIL_SHAPE.test(v)) return true
  return PHONE_SHAPE.test(v) && v.replace(/\D/g, '').length >= 7
}

export function safeDisplayName(
  candidates: Array<string | null | undefined>,
  fallback = 'Someone',
  max = 60,
): string {
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue
    const v = raw.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (!v || isContactShaped(v)) continue
    return v.length > max ? `${v.slice(0, max - 1)}…` : v
  }
  return fallback
}
