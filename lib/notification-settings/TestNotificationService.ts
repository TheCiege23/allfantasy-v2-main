import type { NotificationCategoryId } from "./types"

interface SendTestNotificationResult {
  ok: boolean
  sent?: {
    inApp: boolean
    email: boolean
    sms: boolean
  }
  blockedReasons?: string[]
  error?: string
  rateLimited?: boolean
}

/**
 * Sends a test notification using current saved settings.
 */
export async function sendTestNotification(params: {
  category: NotificationCategoryId
  channels?: { inApp?: boolean; email?: boolean; sms?: boolean }
}): Promise<SendTestNotificationResult> {
  const res = await fetch("/api/user/notifications/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      category: params.category,
      channels: params.channels ?? { inApp: true, email: false, sms: false },
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 429) {
    return { ok: false, rateLimited: true, error: data?.error ?? "RATE_LIMITED" }
  }
  if (!res.ok) {
    return { ok: false, error: data?.error ?? "SEND_TEST_FAILED" }
  }
  return {
    ok: !!data?.ok,
    sent: data?.sent,
    blockedReasons: data?.blockedReasons ?? [],
  }
}
