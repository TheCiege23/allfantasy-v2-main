import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getSettingsSnapshot, saveSettingsOrchestrated } from "@/lib/user-settings"
import type { SettingsSavePayload } from "@/lib/user-settings"
import { resumeAlertEmails } from "@/lib/email/emailSubscription"

export const dynamic = "force-dynamic"

/**
 * GET /api/user/settings
 * Returns a unified settings snapshot: profile + settings sections.
 */
export async function GET() {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string }
  } | null

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const snapshot = await getSettingsSnapshot(session.user.id)
    if (!snapshot) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    return NextResponse.json(snapshot)
  } catch (err) {
    console.error("[api/user/settings] error:", err)
    return NextResponse.json(
      { error: "Failed to load settings" },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/user/settings
 * Body: { profile?: ProfileUpdatePayload, settings?: UserSettingsUpdatePayload }.
 */
export async function PATCH(req: Request) {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string }
  } | null

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as SettingsSavePayload
  const current = await getSettingsSnapshot(session.user.id)

  // Settings › Notifications › "Resume emails": undo an Unsubscribe for THIS account's address.
  if (body?.emailResubscribe === true) {
    const email = current?.profile.email
    if (!email) return NextResponse.json({ error: "No email address on this account." }, { status: 400 })
    try {
      await resumeAlertEmails(email)
      return NextResponse.json({ ok: true })
    } catch {
      return NextResponse.json({ error: "Your email alerts could not be resumed. Please try again." }, { status: 503 })
    }
  }
  const currentNotificationPreferences =
    (current?.profile.notificationPreferences &&
    typeof current.profile.notificationPreferences === "object"
      ? current.profile.notificationPreferences
      : {}) as Record<string, unknown>
  const aiSettings =
    body?.aiSettings && typeof body.aiSettings === "object"
      ? Object.fromEntries(
          Object.entries(body.aiSettings).filter(
            ([, value]) => typeof value === "boolean"
          )
        )
      : null
  const result = await saveSettingsOrchestrated({
    userId: session.user.id,
    existingPreferenceFallback: {
      preferredLanguage: current?.profile.preferredLanguage ?? null,
      themePreference: current?.profile.themePreference ?? null,
      timezone: current?.profile.timezone ?? null,
    },
    payload: {
      profile: aiSettings
        ? {
            ...(body?.profile ?? {}),
            notificationPreferences: {
              ...currentNotificationPreferences,
              aiSettings,
            },
          }
        : body?.profile,
      settings: body?.settings,
    },
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "Failed to update settings" },
      { status: 400 }
    )
  }

  return NextResponse.json({ ok: true })
}
