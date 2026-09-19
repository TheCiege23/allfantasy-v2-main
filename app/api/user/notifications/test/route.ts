import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getClientIp, rateLimit } from "@/lib/rate-limit"
import { getSettingsProfile } from "@/lib/user-settings"
import { createPlatformNotification } from "@/lib/platform/notification-service"
import { sendNotificationEmail } from "@/lib/resend-client"
import { getTwilioRuntimeStatus, sendSms } from "@/lib/twilio-client"
import {
  NOTIFICATION_CATEGORY_IDS,
  resolveNotificationPreferences,
  getDeliveryMethodAvailability,
  type NotificationCategoryId,
  type NotificationPreferences,
} from "@/lib/notification-settings"

export const runtime = "nodejs"

function isNotificationCategoryId(value: string): value is NotificationCategoryId {
  return (NOTIFICATION_CATEGORY_IDS as string[]).includes(value)
}

function maskPhone(value?: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (trimmed.length <= 4) return "****"
  return `${trimmed.slice(0, 2)}******${trimmed.slice(-4)}`
}

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string }
  } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const ip = getClientIp(req)
  const rl = rateLimit(`notification-test:${userId}:${ip}`, 6, 120_000)
  if (!rl.success) {
    return NextResponse.json({ error: "RATE_LIMITED", message: "Please wait before sending another test notification." }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  const categoryCandidate = String(body?.category ?? "system_account").trim()
  const category = isNotificationCategoryId(categoryCandidate)
    ? categoryCandidate
    : "system_account"

  const channels = body?.channels as { inApp?: boolean; email?: boolean; sms?: boolean } | undefined
  const requested = {
    inApp: channels?.inApp !== false,
    email: channels?.email === true,
    sms: channels?.sms === true,
  }

  const profile = await getSettingsProfile(userId)
  if (!profile) {
    return NextResponse.json({ error: "PROFILE_NOT_FOUND" }, { status: 404 })
  }

  const prefs = resolveNotificationPreferences(
    profile.notificationPreferences as NotificationPreferences | null
  )
  const catPrefs = prefs.categories?.[category] ?? {
    enabled: true,
    inApp: true,
    email: true,
    sms: false,
  }
  const availability = getDeliveryMethodAvailability({
    hasEmail: !!profile.email,
    phoneVerified: !!profile.phoneVerifiedAt,
  })
  const twilioRuntimeStatus = getTwilioRuntimeStatus()

  const blockedReasons: string[] = []
  if (prefs.globalEnabled === false) blockedReasons.push("global_disabled")
  if (catPrefs.enabled === false) blockedReasons.push("category_disabled")

  let inAppSent = false
  let emailSent = false
  let smsSent = false
  let attemptedSms = false
  let reasonSkipped: string | null = null

  if (requested.inApp && availability.inApp && prefs.globalEnabled !== false && catPrefs.enabled && catPrefs.inApp) {
    inAppSent = await createPlatformNotification({
      userId,
      productType: "shared",
      type: "test_notification",
      title: "Test notification",
      body: `Your ${category.replace(/_/g, " ")} settings are working.`,
      severity: "low",
      meta: {
        category,
        actionHref: "/settings?tab=notifications",
        actionLabel: "Open settings",
      },
    })
    /*
     * 🛑 THE ONE CHANNEL WHOSE FAILURE HAD NO REASON, ON THE ONE SCREEN WHOSE JOB IS REASONS.
     *
     * `createPlatformNotification` catches everything and returns false — a dead connection, a
     * missing table and a P2022 column mismatch all look identical from here. Email and SMS
     * below each push their own `*_send_failed`; in-app pushed nothing, so the response came
     * back `ok: false` with an EMPTY `blockedReasons`, and the settings screen fell through to
     * its generic "Failed to send test notification." A diagnostic that cannot name the channel
     * it failed on tells the reader less than they already knew.
     */
    if (!inAppSent) blockedReasons.push("inapp_send_failed")
  } else if (requested.inApp && !availability.inApp) {
    blockedReasons.push("inapp_unavailable")
  } else if (requested.inApp && !catPrefs.inApp) {
    blockedReasons.push("inapp_disabled")
  }

  if (requested.email && availability.email && profile.email && prefs.globalEnabled !== false && catPrefs.enabled && catPrefs.email) {
    const result = await sendNotificationEmail({
      to: profile.email,
      subject: "AllFantasy test notification",
      bodyHtml: `Your ${category.replace(/_/g, " ")} email notifications are configured.`,
      actionHref: "/settings?tab=notifications",
      actionLabel: "Open settings",
    })
    emailSent = result.ok
    if (!result.ok) blockedReasons.push("email_send_failed")
  } else if (requested.email && !availability.email) {
    blockedReasons.push("email_unavailable")
  } else if (requested.email && !catPrefs.email) {
    blockedReasons.push("email_disabled")
  }

  if (
    requested.sms &&
    availability.sms &&
    profile.phone &&
    prefs.globalEnabled !== false &&
    catPrefs.enabled &&
    catPrefs.sms &&
    twilioRuntimeStatus.canUseRawSms
  ) {
    attemptedSms = true
    smsSent = await sendSms(
      profile.phone,
      `AllFantasy test notification: ${category.replace(/_/g, " ")} SMS is configured.`
    )
    if (!smsSent) blockedReasons.push("sms_send_failed")
  } else if (requested.sms && !twilioRuntimeStatus.canUseRawSms) {
    reasonSkipped = "twilio_raw_sms_not_configured"
    blockedReasons.push(reasonSkipped)
  } else if (requested.sms && !availability.sms) {
    reasonSkipped = "sms_unavailable"
    blockedReasons.push(reasonSkipped)
  } else if (requested.sms && !catPrefs.sms) {
    reasonSkipped = "sms_disabled"
    blockedReasons.push(reasonSkipped)
  } else if (requested.sms && prefs.globalEnabled === false) {
    reasonSkipped = "global_disabled"
  } else if (requested.sms && catPrefs.enabled === false) {
    reasonSkipped = "category_disabled"
  } else if (requested.sms && !profile.phone) {
    reasonSkipped = "phone_missing"
    blockedReasons.push(reasonSkipped)
  }

  return NextResponse.json({
    ok: inAppSent || emailSent || smsSent,
    sent: {
      inApp: inAppSent,
      email: emailSent,
      sms: smsSent,
    },
    blockedReasons,
    twilioRuntimeStatus,
    attemptedSms,
    smsSent,
    reasonSkipped,
    smsDestination: attemptedSms ? maskPhone(profile.phone) : null,
  })
}
