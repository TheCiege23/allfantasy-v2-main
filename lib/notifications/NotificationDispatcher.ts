import "server-only"
import { createPlatformNotification } from "@/lib/platform/notification-service"
import { getSettingsProfile } from "@/lib/user-settings"
import { resolveNotificationPreferences } from "@/lib/notification-settings/NotificationPreferenceResolver"
import { getDeliveryMethodAvailability } from "@/lib/notification-settings/DeliveryMethodResolver"
import type { NotificationCategoryId, NotificationPreferences } from "@/lib/notification-settings/types"
import { sendNotificationEmail, sendTemplatedEmail } from "@/lib/resend-client"
import { sendSms } from "@/lib/twilio-client"
import { reserveSmsToday } from "@/lib/notifications/smsDailyCap"
import { sendPushToUser } from "@/lib/push-notifications"
import { decidePush } from "@/lib/notifications/pushGate"
import { retryWithBackoff } from "@/lib/error-handling"
import { isUndeliverableEmailDomain } from "@/lib/email/undeliverableDomains"
import { shouldSuppressTokenMonetizationNotification } from "@/lib/notifications/tokenMonetizationNotificationBypass"
import { quietHoursSuppression } from "@/lib/notifications/quietHours"
import { isCategoryAllowedForLeague, allowedLeaguesForCategory } from "@/lib/notifications/leagueOverrides"
import { pushTagFor } from "@/lib/notifications/pushTag"

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
  /**
   * Every league this one event affects for the recipient — for events that are genuinely
   * multi-league, such as player news about someone a manager rosters in several leagues.
   *
   * 🛑 PASS THIS INSTEAD OF PICKING AN ANCHOR LEAGUE YOURSELF. The per-league mute override is
   * evaluated against the WHOLE set: leagues the user muted are dropped, the notification is
   * skipped only when none survive, and `meta.affectedLeagueIds` is rewritten to the surviving
   * set so the detail view cannot list a league the user has muted. Anchoring on
   * `leagueIds[0]` and letting the single-league gate decide silences eleven un-muted leagues
   * when the anchor happens to be the muted one.
   *
   * `leagueId` remains what is STORED on the row (the first surviving league is used when this
   * is set), because `PlatformNotification.leagueId` is a single column and widening it is a
   * migration.
   */
  leagueIds?: readonly string[] | null
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
 * What actually happened, per recipient.
 *
 * 🛑 THIS FUNCTION USED TO RETURN `void`, AND THAT MADE ITS CALLERS UNABLE TO TELL SUCCESS FROM
 * TOTAL FAILURE. The entire per-user body is wrapped in one try/catch and there is no await
 * outside it, so `dispatchNotification` CANNOT REJECT — a caller's `try { await dispatch() }
 * catch {}` is unreachable code. `PlayerNewsNotificationService` had exactly that, and settled
 * every row as `'delivered'` however completely the send had failed: the row was stamped
 * terminally, nobody was notified, and the `'dispatch-failed'` retry path was dead.
 *
 * ⚠ ADDITIVE — the return value is new and every existing caller ignores it, which is why this
 * is safe to change under ~40 call sites.
 *
 * ⚠ AND `delivered` STILL MEANS "HANDED OFF", NOT "RECEIVED". It counts recipients for whom the
 * in-app row was written without throwing. Email and SMS are best-effort inside the loop, and
 * push is started without being awaited. Provider acceptance and device display are not
 * observable from here and are not claimed.
 */
export type DispatchNotificationResult = {
  /** Recipients passed in. */
  requested: number
  /** Recipients a preference/quiet-hours/league gate deliberately skipped. */
  suppressed: number
  /** Recipients whose in-app write completed without throwing. */
  delivered: number
  /** Recipients whose processing threw. */
  failed: number
}

/**
 * Single entry point for notifications: in-app + optional email and SMS
 * per user preferences and delivery availability (email/phone).
 */
export async function dispatchNotification(
  params: DispatchNotificationParams
): Promise<DispatchNotificationResult> {
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
    leagueIds,
    meta,
    severity = "medium",
    dedupePrefix,
    skipChannels,
    emailOverride,
  } = params

  let suppressed = 0
  let delivered = 0
  let failed = 0

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
        suppressed++
        continue
      }

      const profile = await getSettingsProfile(userId)
      if (!profile) { suppressed++; continue }

      const prefs = resolveNotificationPreferences(
        profile.notificationPreferences as NotificationPreferences | null
      )
      if (!prefs.globalEnabled) { suppressed++; continue }

      const catPrefs = prefs.categories?.[category]
      if (!catPrefs?.enabled) { suppressed++; continue }

      /*
       * Per-league override (spec item 15: global by default, per-league where wanted).
       * Absence inherits the global answer — see leagueOverrides.ts, where treating a
       * missing entry as a decision would have silenced every league on deploy.
       *
       * ⚠ THE MULTI-LEAGUE PATH IS CHECKED FIRST AND IT IS A SET OPERATION, NOT A LOOKUP.
       * When a caller passes `leagueIds`, the mute override is applied across all of them: the
       * muted ones are dropped, the send is skipped only if none survive, and the surviving
       * set replaces `meta.affectedLeagueIds` so the detail view cannot show a league the user
       * has muted. Falling back to the single-league check for a multi-league event silences
       * every other league whenever the anchor happens to be the muted one.
       */
      let survivingLeagueIds: string[] | null = null
      if (leagueIds && leagueIds.length > 0) {
        survivingLeagueIds = allowedLeaguesForCategory(prefs, category, leagueIds)
        if (survivingLeagueIds.length === 0) { suppressed++; continue }
      } else {
        const effectiveLeagueId =
          leagueId ?? (meta && typeof meta.leagueId === "string" ? meta.leagueId : null)
        if (!isCategoryAllowedForLeague(prefs, category, effectiveLeagueId)) { suppressed++; continue }
      }

      /** What gets stored and reported for THIS recipient, after muted leagues are removed. */
      const rowLeagueId =
        survivingLeagueIds?.[0] ??
        leagueId ??
        (meta && typeof meta.leagueId === "string" ? meta.leagueId : undefined)
      const effectiveMeta: Record<string, unknown> = survivingLeagueIds
        ? { ...(meta ?? {}), affectedLeagueIds: survivingLeagueIds }
        : { ...(meta ?? {}) }

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

      /*
       * 🛑 THE RETURN VALUE IS READ. `createPlatformNotification` wraps its whole body in
       * `catch { return false }` — it CANNOT throw — so awaiting it and discarding the boolean
       * meant a failed in-app write counted as a delivery. A Postgres blip produced
       * `{delivered: 40, failed: 0}`, the caller's `failed > 0` test stayed false, the row was
       * stamped terminally and forty people were never notified. Adding a result object in an
       * earlier pass did not fix that on its own; this line is what makes `failed` reachable.
       */
      let inAppWritten = true
      if (catPrefs.inApp && availability.inApp) {
        inAppWritten = await createPlatformNotification({
          userId,
          leagueId: rowLeagueId,
          productType,
          type,
          title,
          body: body ?? undefined,
          severity,
          sourceKey: dedupePrefix ? `${dedupePrefix}:${userId}` : undefined,
          meta: {
            ...effectiveMeta,
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
        // A Twilio charge per text, previously uncapped. Over the daily cap the text is
        // skipped; the in-app row, email and push above/below still go out.
        if (!(await reserveSmsToday(userId))) {
          console.warn("[NotificationDispatcher] SMS daily cap reached; text skipped", { userId, category, type })
        } else {
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
      }

      /*
       * Push goes through pushGate's rule, the same one every direct push sender uses, so a
       * switch honoured here cannot be ignored elsewhere. Since 2026-09-14 push has its own
       * per-category switch; a row without one follows in-app, as push always did.
       */
      const push = decidePush(profile.notificationPreferences as NotificationPreferences | null, {
        category,
        /*
         * The league the row was stored against: for a single-league event that is the same
         * `leagueId ?? meta.leagueId` the gate above checked; for a multi-league event it is the
         * first SURVIVING league, so a muted anchor cannot veto the push for the rest.
         */
        leagueId: rowLeagueId ?? null,
        severity,
        fallbackTimezone: profile.timezone,
      })
      if (push.allowed && !skipChannels?.push) {
        sendPushToUser(userId, {
          title,
          body: body ?? undefined,
          href: actionHref,
          // One tag per category unless the caller names one per event — see pushTagFor.
          tag: pushTagFor(category, meta),
          type,
        }).catch((e) => console.error("[NotificationDispatcher] push error for user", userId, e))
      }
      if (inAppWritten) delivered++
      else failed++
    } catch (e) {
      failed++
      console.error("[NotificationDispatcher] dispatch error for user", userId, e)
    }
  }

  return { requested: userIds.length, suppressed, delivered, failed }
}
