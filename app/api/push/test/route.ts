import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"
import { getPushSubscriptions, sendPushToUser } from "@/lib/push-notifications"
import { IOS_ENDPOINT_PREFIX } from "@/lib/push-notifications/apns"
import { buildTestPush, explainPushFailure, type TestPushDevice } from "@/lib/push-notifications/testPush"

export const dynamic = "force-dynamic"

/**
 * POST → sends the signed-in user one sample alert on every device they turned alerts on for,
 * and reports per device what happened (see lib/push-notifications/testPush).
 *
 * Push only: no bell row, no email, no SMS — it is a test of the phone, not a notification.
 * It also skips quiet hours and category toggles on purpose; the user just pressed a button
 * asking for exactly this.
 */
export async function POST() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = typeof session?.user?.id === "string" && session.user.id.trim() ? session.user.id : null
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!rateLimit(`push-test:${userId}`, 3, 60_000).success) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Give it a minute before sending another test." },
      { status: 429 },
    )
  }

  const subs = await getPushSubscriptions(userId)
  if (subs.length === 0) {
    return NextResponse.json(
      { error: "NO_DEVICES", message: "Turn on alerts on this device first." },
      { status: 409 },
    )
  }
  const kindById = new Map(
    subs.map((s) => [s.id, s.endpoint.startsWith(IOS_ENDPOINT_PREFIX) ? ("iphone" as const) : ("browser" as const)]),
  )

  const results = await sendPushToUser(userId, buildTestPush())
  const devices: TestPushDevice[] = results.map((r) => {
    const kind = (r.subscriptionId && kindById.get(r.subscriptionId)) || "browser"
    return r.ok ? { kind, ok: true } : explainPushFailure(kind, r.error)
  })
  const sent = devices.filter((d) => d.ok).length

  if (sent === 0) {
    // Logged so a failure the user reports can be read back; codes only, never a token.
    console.warn("[push/test] no device accepted", { userId, codes: devices.map((d) => d.code ?? "unknown") })
  }
  return NextResponse.json({ ok: sent > 0, sent, failed: devices.length - sent, devices })
}
