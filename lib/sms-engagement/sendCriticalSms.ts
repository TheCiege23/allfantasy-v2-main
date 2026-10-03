/**
 * Send SMS only (no in-app/email). Use for cron or when only SMS is desired.
 * Respects user notification prefs: category must have sms enabled and phone verified.
 */

import { getSettingsProfile } from "@/lib/user-settings"
import { resolveNotificationPreferences } from "@/lib/notification-settings/NotificationPreferenceResolver"
import { getDeliveryMethodAvailability } from "@/lib/notification-settings/DeliveryMethodResolver"
import type { NotificationCategoryId, NotificationPreferences } from "@/lib/notification-settings/types"
import { sendSms } from "@/lib/twilio-client"
import { hasSmsConsent } from "@/lib/sms/smsConsent"
import type { SmsSendResult } from "./types"

const SMS_MAX_LENGTH = 320

/**
 * Send a critical SMS to one user. Only sends if user has verified phone and SMS enabled for the category.
 */
export async function sendCriticalSms(
  userId: string,
  category: NotificationCategoryId,
  message: string
): Promise<SmsSendResult> {
  const profile = await getSettingsProfile(userId)
  if (!profile?.phone) {
    return { ok: false, userId, error: "No phone" }
  }
  if (!profile.phoneVerifiedAt) {
    return { ok: false, userId, error: "Phone not verified" }
  }

  const prefs = resolveNotificationPreferences(
    profile.notificationPreferences as NotificationPreferences | null
  )
  if (!prefs.globalEnabled) {
    return { ok: false, userId, error: "Notifications disabled" }
  }

  const catPrefs = prefs.categories?.[category]
  if (!catPrefs?.enabled || !catPrefs.sms) {
    return { ok: false, userId, error: "SMS disabled for category" }
  }

  const availability = getDeliveryMethodAvailability({
    hasEmail: !!profile.email,
    phoneVerified: !!profile.phoneVerifiedAt,
    smsConsented: hasSmsConsent(profile.notificationPreferences, profile.phone),
  })
  if (!availability.sms) {
    return { ok: false, userId, error: "SMS not available" }
  }

  const body = message.slice(0, SMS_MAX_LENGTH)
  const ok = await sendSms(profile.phone, body)
  return ok ? { ok: true, userId } : { ok: false, userId, error: "Send failed" }
}

/**
 * Send the same critical SMS to multiple users. Skips users without phone/SMS enabled.
 */
export async function sendCriticalSmsToUsers(
  userIds: string[],
  category: NotificationCategoryId,
  message: string
): Promise<SmsSendResult[]> {
  const results: SmsSendResult[] = []
  for (const userId of userIds) {
    const result = await sendCriticalSms(userId, category, message)
    results.push(result)
  }
  return results
}
