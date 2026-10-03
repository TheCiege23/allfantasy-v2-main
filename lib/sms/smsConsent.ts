import { normalizePhoneE164 } from '@/lib/phone/e164'

/**
 * Whether a profile holds a live SMS consent for the number it would be texted at.
 *
 * ⚠ THE CONSENT RECORD WAS WRITTEN AND NEVER READ. `/api/verify/phone/start` stores
 * `notificationPreferences.smsConsent` when the opt-in box is ticked, but every sender gated
 * on `phoneVerifiedAt` alone — and several flows verify a phone with no box at all (phone
 * signup, `register` with method PHONE, the shared verification proxy). The A2P campaign
 * says texts go to people who opted in; this is the check that makes that true.
 *
 * ⚠ CONSENT IS PER NUMBER. A record for a number the user has since replaced does not cover
 * the new one — the new number never agreed to anything.
 *
 * ⚠ A STOP REVOKES IT. `recordSmsOptOut` (on Twilio error 21610) writes `revokedAt`; a later
 * opt-in through the box writes a fresh record without it, which is the only way back.
 *
 * Applies to texts the program sends on its own (notifications). A text the user asks for at
 * that moment — a password-reset code, "send me a test text" — is not gated here.
 *
 * Client-safe: no prisma.
 */
export type SmsConsentRecord = {
  consentedAt?: string
  phone?: string
  revokedAt?: string
  revokedReason?: string
}

export function readSmsConsent(notificationPreferences: unknown): SmsConsentRecord | null {
  if (!notificationPreferences || typeof notificationPreferences !== 'object') return null
  const raw = (notificationPreferences as Record<string, unknown>).smsConsent
  return raw && typeof raw === 'object' ? (raw as SmsConsentRecord) : null
}

function sameNumber(a: string, b: string): boolean {
  try {
    return normalizePhoneE164(a) === normalizePhoneE164(b)
  } catch {
    return a.replace(/\D/g, '') === b.replace(/\D/g, '')
  }
}

export function hasSmsConsent(notificationPreferences: unknown, phone: string | null | undefined): boolean {
  const record = readSmsConsent(notificationPreferences)
  if (!record?.consentedAt || !phone) return false
  if (record.revokedAt) return false
  if (record.phone && !sameNumber(record.phone, phone)) return false
  return true
}

/**
 * The preferences object with any live SMS consent marked withdrawn — the same shape
 * `recordSmsOptOut` writes on a STOP. Kept, never deleted: the record of when someone opted in and
 * out is the compliance trail. Every other preference passes through untouched. An already
 * withdrawn (or absent) record is returned as-is, so the original withdrawal date is not rewritten.
 */
export function withdrawSmsConsent(notificationPreferences: unknown, reason: string, now: Date = new Date()): Record<string, unknown> {
  const prefs =
    notificationPreferences && typeof notificationPreferences === 'object' && !Array.isArray(notificationPreferences)
      ? (notificationPreferences as Record<string, unknown>)
      : {}
  const record = readSmsConsent(prefs)
  if (!record || record.revokedAt) return { ...prefs }
  return { ...prefs, smsConsent: { ...record, revokedAt: now.toISOString(), revokedReason: reason } }
}
