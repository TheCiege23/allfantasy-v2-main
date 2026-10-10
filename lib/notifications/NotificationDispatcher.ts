import "server-only"
import { createPlatformNotification } from "@/lib/platform/notification-service"
import { getSettingsProfile } from "@/lib/user-settings"
import { resolveNotificationPreferences } from "@/lib/notification-settings/NotificationPreferenceResolver"
import { getDeliveryMethodAvailability } from "@/lib/notification-settings/DeliveryMethodResolver"
import type { NotificationCategoryId, NotificationPreferences } from "@/lib/notification-settings/types"
import { sendNotificationEmail, sendTemplatedEmail } from "@/lib/resend-client"
import { sendSms } from "@/lib/twilio-client"
import { hasSmsConsent } from "@/lib/sms/smsConsent"
import { reserveSmsToday } from "@/lib/notifications/smsDailyCap"
import { sendPushToUser } from "@/lib/push-notifications"
import { decidePush } from "@/lib/notifications/pushGate"
import { retryWithBackoff } from "@/lib/error-handling"
import { isUndeliverableEmailDomain } from "@/lib/email/undeliverableDomains"
import { shouldSuppressTokenMonetizationNotification } from "@/lib/notifications/tokenMonetizationNotificationBypass"
import { quietHoursSuppression } from "@/lib/notifications/quietHours"
import { isCategoryAllowedForLeague } from "@/lib/notifications/leagueOverrides"
import { pushTagFor } from "@/lib/notifications/pushTag"
import { emailWithheldByUnsubscribe } from "@/lib/email/emailSubscription"

import type { NotificationDeliveryReceipt, DeliveryChannelOutcome } from './deliveryReceipt'
export type DispatchNotificationParams = {
  /** Opt-in durable receipts. Await push results only for callers that request tracking. */
  onDeliveryReceipt?: (receipt: NotificationDeliveryReceipt) => Promise<void>
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
  /**
   * The text to SMS instead of `title` + `body`. Pass it whenever `body` carries words another
   * user wrote (broadcasts, chat, DMs): the A2P campaign covers notifications, and carriers
   * treat user-generated content over SMS as its own risk class — so the text says THAT there
   * is a message and where, and the words stay in-app, email and push.
   */
  smsBody?: string
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
    const channels: NotificationDeliveryReceipt['channels'] = {
      inApp: {status:'unknown',reason:'evaluation_incomplete'}, email: {status:'unknown',reason:'evaluation_incomplete'},
      sms: {status:'unknown',reason:'evaluation_incomplete'}, push: {status:'unknown',reason:'evaluation_incomplete'},
    }
    const suppressAll = (reason: string) => { for (const channel of Object.keys(channels) as Array<keyof typeof channels>) channels[channel] = {status:'suppressed',reason} }
    const set = (channel:keyof typeof channels,outcome:DeliveryChannelOutcome) => { channels[channel]=outcome }
    try {
      if (
        shouldSuppressTokenMonetizationNotification(userId, {
          type,
          title,
          body,
          category,
        })
      ) {
        suppressAll('policy_bypass'); continue
      }

      const profile = await getSettingsProfile(userId)
      if (!profile) { suppressAll('no_profile'); continue }

      const prefs = resolveNotificationPreferences(
        profile.notificationPreferences as NotificationPreferences | null
      )
      if ((profile.notificationPreferences as NotificationPreferences | null)?.globalEnabled === false || !prefs.globalEnabled) { suppressAll('global_off'); continue }

      const catPrefs = prefs.categories?.[category]
      if (!catPrefs?.enabled) { suppressAll('category_off'); continue }

      /*
       * Per-league override (spec item 15: global by default, per-league where wanted).
       * Absence inherits the global answer — see leagueOverrides.ts, where treating a
       * missing entry as a decision would have silenced every league on deploy.
       */
      const effectiveLeagueId =
        leagueId ?? (meta && typeof meta.leagueId === "string" ? meta.leagueId : null)
      if (!isCategoryAllowedForLeague(prefs, category, effectiveLeagueId)) { suppressAll('league_muted'); continue }

      const availability = getDeliveryMethodAvailability({
        hasEmail: !!profile.email,
        phoneVerified: !!profile.phoneVerifiedAt,
        smsConsented: hasSmsConsent(profile.notificationPreferences, profile.phone),
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
        const stored = await createPlatformNotification({
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
        set('inApp',{status:stored?'stored':'failed',reason:stored?'in_app_saved':'storage_failed'})
      } else set('inApp',{status:'suppressed',reason:'channel_off'})

      // Undeliverable domains (RFC-reserved fixture rows, example.com seeds)
      // never get a send — they only bounce and burn the sending domain.
      //
      // ⚠ AND AN UNSUBSCRIBED ADDRESS GETS NO ALERT EMAIL. Every notification email carries an
      // Unsubscribe link, which wrote `EmailPreference.unsubscribedAt` — and this dispatcher never
      // read it, so alerts kept arriving after the user had clicked it (found 2026-10-03). Account
      // notices (`system_account`) still send, as the unsubscribe page says; a failed read withholds.
      if (
        catPrefs.email &&
        availability.email &&
        profile.email &&
        !skipChannels?.email &&
        !isUndeliverableEmailDomain(profile.email) &&
        !emailWithheldByUnsubscribe(profile.emailSubscription, category)
      ) {
        let attempts=0,providerId:string|undefined
        try {
          await retryWithBackoff(
            async () => {
              attempts++
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
              providerId=result.providerId
              if (!result.ok) {
                const err = new Error(result.error ?? "Email send failed") as Error & { status?: number }
                err.status = 503
                throw err
              }
            },
            { maxAttempts: 2, baseMs: 500, maxMs: 2000 }
          )
          set('email',{status:'accepted',reason:'provider_accepted',attempts,...(providerId?{providerId}:{})})
        } catch (e) {
          set('email',{status:'failed',reason:'provider_failed',attempts})
          console.warn("[NotificationDispatcher] email send failed after retry for user", userId, e)
        }
      } else set('email',{status:'suppressed',reason:!catPrefs.email?'channel_off':skipChannels?.email?'caller_excluded':!availability.email||!profile.email?'contact_unavailable':isUndeliverableEmailDomain(profile.email)?'undeliverable_domain':'unsubscribed'})

      if (catPrefs.sms && availability.sms && profile.phone && !skipChannels?.sms && !quiet.sms) {
        // A Twilio charge per text, previously uncapped. Over the daily cap the text is
        // skipped; the in-app row, email and push above/below still go out.
        if (!(await reserveSmsToday(userId))) {
          set('sms',{status:'suppressed',reason:'daily_cap'})
          console.warn("[NotificationDispatcher] SMS daily cap reached; text skipped", { userId, category, type })
        } else {
          const smsText = params.smsBody ?? (body ? `${title}\n${body}` : title)
          let smsSent=false,smsProviderId:string|undefined
          try { smsSent=params.onDeliveryReceipt?await sendSms(profile.phone,smsText.slice(0,320),id=>{smsProviderId=id}):await sendSms(profile.phone,smsText.slice(0,320)) } catch { /* Receipt records failure; other channels still run. */ }
          set('sms',{status:smsSent?'accepted':'failed',reason:smsSent?'provider_accepted':'provider_failed',attempts:1,...(smsProviderId?{providerId:smsProviderId}:{})})
          if (!smsSent) {
            console.error("[NotificationDispatcher] SMS send returned false", {
              userId,
              category,
              type,
            })
          }
        }
      } else set('sms',{status:'suppressed',reason:!catPrefs.sms?'channel_off':skipChannels?.sms?'caller_excluded':quiet.sms?'quiet_hours':'contact_or_consent_unavailable'})

      /*
       * Push goes through pushGate's rule, the same one every direct push sender uses, so a
       * switch honoured here cannot be ignored elsewhere. Since 2026-09-14 push has its own
       * per-category switch; a row without one follows in-app, as push always did.
       */
      const push = decidePush(profile.notificationPreferences as NotificationPreferences | null, {
        category,
        leagueId: effectiveLeagueId,
        severity,
        fallbackTimezone: profile.timezone,
      })
      if (push.allowed && !skipChannels?.push) {
        const payload = {
          title,
          body: body ?? undefined,
          href: actionHref,
          // One tag per category unless the caller names one per event — see pushTagFor.
          tag: pushTagFor(category, meta),
          type,
          // The service worker builds league-scoped action buttons from this; it was dropped here.
          leagueId: effectiveLeagueId,
          // A producer that has a picture (headshot, trade card) names it in meta.imageUrl.
          imageUrl: typeof meta?.imageUrl === "string" ? meta.imageUrl : null,
          // A producer with a face for it (a DM's sender) names it in meta.iconUrl.
          iconUrl: typeof meta?.iconUrl === "string" ? meta.iconUrl : null,
        }
        const sending=params.onDeliveryReceipt?sendPushToUser(userId,payload,{strictSubscriptionRead:true}):sendPushToUser(userId,payload)
        if (params.onDeliveryReceipt) {
          try {
            const results=await sending, accepted=results.filter(r=>r.ok).length
            set('push',results.length===0?{status:'suppressed',reason:'no_subscriptions'}:{status:accepted===results.length?'accepted':accepted>0?'partial':'failed',reason:accepted>0?'provider_accepted':'provider_failed',endpoints:results.length,acceptedEndpoints:accepted})
          } catch { set('push',{status:'failed',reason:'push_attempt_failed'}) }
        } else {
          /*
           * 🛑 A PUSH THAT FAILED WITHOUT THROWING WAS INVISIBLE. `sendPushToUser` reports per-device
           * results and only throws on a bug, so a missing VAPID or APNs key turned every push into a
           * no-op with zero log lines. Say so when NOTHING got through — the error class only, never
           * an endpoint URL (those are capability URLs).
           */
          sending
            .then((results) => {
              if (results.length === 0 || results.some((r) => r.ok)) return
              const errors = [...new Set(results.map((r) => String(r.error ?? 'unknown').replace(/https?:\/\/\S+/g, '<url>').slice(0, 120)))]
              console.warn("[NotificationDispatcher] push not delivered", { userId, type, endpoints: results.length, errors })
            })
            .catch((e) => console.error("[NotificationDispatcher] push error for user", userId, e))
        }
      } else set('push',{status:'suppressed',reason:skipChannels?.push?'caller_excluded':!push.allowed?push.reason:'channel_off'})
    } catch (e) {
      for (const channel of Object.keys(channels) as Array<keyof typeof channels>) if(channels[channel].status==='unknown') set(channel,{status:'unknown',reason:'dispatch_interrupted'})
      console.error("[NotificationDispatcher] dispatch error for user", userId, e)
    } finally {
      if(params.onDeliveryReceipt) {
        try { await params.onDeliveryReceipt({userId,completedAt:new Date().toISOString(),channels}) }
        catch { console.error('[NotificationDispatcher] receipt persistence failed', {userId,type}) }
      }
    }
  }
}
