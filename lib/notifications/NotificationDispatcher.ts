import "server-only"
import { createPlatformNotification } from "@/lib/platform/notification-service"
import { getSettingsProfile } from "@/lib/user-settings"
import { resolveNotificationPreferences } from "@/lib/notification-settings/NotificationPreferenceResolver"
import { getDeliveryMethodAvailability } from "@/lib/notification-settings/DeliveryMethodResolver"
import type { NotificationCategoryId, NotificationPreferences } from "@/lib/notification-settings/types"
import { sendNotificationEmail, sendTemplatedEmail } from "@/lib/resend-client"
import { sendSms } from "@/lib/twilio-client"
import { sendPushToUser, isPushCategory } from "@/lib/push-notifications"
import { retryWithBackoff } from "@/lib/error-handling"
import { isUndeliverableEmailDomain } from "@/lib/email/undeliverableDomains"
import { shouldSuppressTokenMonetizationNotification } from "@/lib/notifications/tokenMonetizationNotificationBypass"
import { quietHoursSuppression } from "@/lib/notifications/quietHours"
import { isCategoryAllowedForLeague } from "@/lib/notifications/leagueOverrides"

export type DispatchNotificationParams = {
  userIds: string[]
  category: NotificationCategoryId
  productType?: "shared" | "app" | "bracket" | "legacy"
  type: string
  title: string
  body?: string
  actionHref?: string
  actionLabel?: string
  /** When set, stored on `PlatformNotification.leagueId` for filtering and analytics. */
  leagueId?: string | null
  meta?: Record<string, unknown>
  severity?: "low" | "medium" | "high"
  /** When set, `PlatformNotification.sourceKey` = `${dedupePrefix}:${userId}` to reduce duplicate in-app rows. */
  dedupePrefix?: string
  /**
   * Opt-out specific transport channels for this dispatch call.
   * Used by ChimmyAlertEngine to respect per-alert channel filtering
   * (e.g. when applyChannelPrefs has already stripped email/sms/push).
   */
  skipChannels?: { email?: boolean; sms?: boolean; push?: boolean }
  /**
   * A fully designed email for this dispatch — subject + leaf-escaped HTML from
   * a real renderer (the draftEmails / tradeGradeEmail family). Sent through
   * sendTemplatedEmail instead of the plain-paragraph sendNotificationEmail
   * wrapper, behind exactly the same category / availability /
   * undeliverable-domain gates. Content is per-recipient, so pass it only on
   * single-user dispatches.
   */
  emailOverride?: { subject: string; html: string }
}

/**
 * Single entry point for notifications: in-app + optional email and SMS
 * per user preferences and delivery availability (email/phone).
 */
export async function dispatchNotification(params: DispatchNotificationParams): Promise<void> {
  const {
    userIds,
    category,
    productType = "app",
    type,
    title,
    body,
    actionHref,
    actionLabel,
    leagueId,
    meta,
    severity = "medium",
    dedupePrefix,
    skipChannels,
    emailOverride,
  } = params

  for (const userId of userIds) {
    try {
      if (
        shouldSuppressTokenMonetizationNotification(userId, {
          type,
          title,
          body,
          category,
        })
      ) {
        continue
      }

      const profile = await getSettingsProfile(userId)
      if (!profile) continue

      const prefs = resolveNotificationPreferences(
        profile.notificationPreferences as NotificationPreferences | null
      )
      if (!prefs.globalEnabled) continue

      const catPrefs = prefs.categories?.[category]
      if (!catPrefs?.enabled) continue

      /*
       * Per-league override (spec item 15: global by default, per-league where wanted).
       * Absence inherits the global answer — see leagueOverrides.ts, where treating a
       * missing entry as a decision would have silenced every league on deploy.
       */
      const effectiveLeagueId =
        leagueId ?? (meta && typeof meta.leagueId === "string" ? meta.leagueId : null)
      if (!isCategoryAllowedForLeague(prefs, category, effectiveLeagueId)) continue

      const availability = getDeliveryMethodAvailability({
        hasEmail: !!profile.email,
        phoneVerified: !!profile.phoneVerifiedAt,
      })

      /*
       * Quiet hours (spec item 16), evaluated in the USER's timezone.
       *
       * ⚠ THIS SUPPRESSES PUSH AND SMS ONLY. The in-app row below is a log; dropping it
       * would mean the user wakes to no record that anything happened and the unread
       * badge — which counts stored rows — under-reports their night. Quiet hours defer
       * a buzz, they do not delete history.
       *
       * The profile timezone is passed as the fallback because the stored preference's
       * own `timezone` was accepted by the API and never read by anything; see
       * quietHours.ts for what that silently did to every user who set one.
       */
      const quiet = quietHoursSuppression(
        prefs.quietHours,
        new Date(),
        severity,
        profile.timezone
      )

      if (catPrefs.inApp && availability.inApp) {
        await createPlatformNotification({
          userId,
          leagueId: leagueId ?? (meta && typeof meta.leagueId === "string" ? meta.leagueId : undefined),
          productType,
          type,
          title,
          body: body ?? undefined,
          severity,
          sourceKey: dedupePrefix ? `${dedupePrefix}:${userId}` : undefined,
          meta: {
            ...(meta ?? {}),
            notificationCategory: category,
            ...(actionHref && { actionHref, actionLabel: actionLabel ?? "Open" }),
          },
        })
      }

      // Undeliverable domains (RFC-reserved fixture rows, example.com seeds)
      // never get a send — they only bounce and burn the sending domain.
      if (
        catPrefs.email &&
        availability.email &&
        profile.email &&
        !skipChannels?.email &&
        !isUndeliverableEmailDomain(profile.email)
      ) {
        try {
          await retryWithBackoff(
            async () => {
              const result = emailOverride
                ? await sendTemplatedEmail({
                    to: profile.email!,
                    subject: emailOverride.subject,
                    html: emailOverride.html,
                  })
                : await sendNotificationEmail({
                    to: profile.email!,
                    subject: title,
                    bodyHtml: body ?? title,
                    actionHref,
                    actionLabel: actionLabel ?? "Open",
                  })
              if (!result.ok) {
                const err = new Error(result.error ?? "Email send failed") as Error & { status?: number }
                err.status = 503
                throw err
              }
            },
            { maxAttempts: 2, baseMs: 500, maxMs: 2000 }
          )
        } catch (e) {
          console.warn("[NotificationDispatcher] email send failed after retry for user", userId, e)
        }
      }

      if (catPrefs.sms && availability.sms && profile.phone && !skipChannels?.sms && !quiet.sms) {
        const smsBody = body ? `${title}\n${body}` : title
        const smsSent = await sendSms(profile.phone, smsBody.slice(0, 320))
        if (!smsSent) {
          console.error("[NotificationDispatcher] SMS send returned false", {
            userId,
            category,
            type,
          })
        }
      }

      if (
        catPrefs.inApp &&
        availability.inApp &&
        isPushCategory(category) &&
        !skipChannels?.push &&
        !quiet.push
      ) {
        sendPushToUser(userId, {
          title,
          body: body ?? undefined,
          href: actionHref,
          tag: `notif-${category}-${meta?.leagueId ?? "global"}`,
          type,
        }).catch((e) => console.error("[NotificationDispatcher] push error for user", userId, e))
      }
    } catch (e) {
      console.error("[NotificationDispatcher] dispatch error for user", userId, e)
    }
  }
}
