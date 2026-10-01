import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizePhoneE164 } from '@/lib/phone/e164'
import { readSmsConsent } from '@/lib/sms/smsConsent'

/** Twilio's "The message From/To pair violates a blacklist rule" — the recipient replied STOP. */
export const TWILIO_OPTED_OUT_CODE = 21610

/**
 * Record that a number has opted out of texts, so the app stops trying to send to it.
 *
 * ⚠ THE APP NEVER LEARNED ABOUT A STOP. Twilio's Advanced Opt-Out blocks the number at the
 * service, and every later send failed with 21610 — which `sendSms` logged and returned
 * `false` for, leaving the user's SMS switches on forever. Revoking the consent record makes
 * `hasSmsConsent` false, which every program-initiated sender checks.
 *
 * Merges into `notificationPreferences` (never overwrites), the same way the opt-in is written.
 * Best-effort: a failure here must never turn a failed text into a thrown request.
 */
export async function recordSmsOptOut(phone: string, reason = 'twilio_21610'): Promise<number> {
  const normalized = normalizePhoneE164(phone)
  if (!normalized) return 0
  try {
    const profiles: Array<{ userId: string; notificationPreferences: unknown }> = await (prisma as any).userProfile.findMany({
      where: { phone: normalized },
      select: { userId: true, notificationPreferences: true },
    })
    let revoked = 0
    for (const p of profiles) {
      const prefs = (p.notificationPreferences ?? {}) as Record<string, unknown>
      const record = readSmsConsent(prefs)
      if (record?.revokedAt) continue
      await (prisma as any).userProfile.update({
        where: { userId: p.userId },
        data: {
          notificationPreferences: {
            ...prefs,
            smsConsent: { ...(record ?? {}), revokedAt: new Date().toISOString(), revokedReason: reason },
          },
        },
      })
      revoked += 1
    }
    return revoked
  } catch (err) {
    console.error('[sms] failed to record opt-out', err instanceof Error ? err.message : 'unknown error')
    return 0
  }
}

/** True when a Twilio error says the recipient has opted out (replied STOP). */
export function isTwilioOptOutError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === TWILIO_OPTED_OUT_CODE || code === String(TWILIO_OPTED_OUT_CODE)
}
