import type { NotificationPreferences } from "./types"

/**
 * Saves notification preferences via PATCH /api/user/profile.
 */
export async function updateNotificationPreferences(
  prefs: NotificationPreferences
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/user/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ notificationPreferences: prefs }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, error: data.error ?? "Failed to save" }
  return { ok: true }
}
