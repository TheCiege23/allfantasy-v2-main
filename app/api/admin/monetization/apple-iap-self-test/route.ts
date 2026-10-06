import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/adminAuth"
import { checkAppleIapConfig, sendAppleTestNotification } from "@/lib/monetization/appleIapSelfTest"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Admin-only check that the Apple In-App Purchase setup is CORRECT, not just present.
 *
 *   GET ?                       config shapes only (no network)
 *   GET ?send=sandbox           …plus ask Apple to send a TEST notification to the sandbox URL
 *   GET ?send=production        …the same against the production URL
 *
 * A test notification is harmless (the notifications route acknowledges TEST without touching
 * any account), so it is a GET an admin can open in a browser. Nothing secret is returned.
 */
export async function GET(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const checks = checkAppleIapConfig()
  const send = new URL(request.url).searchParams.get("send")
  const configOk = checks.every((c) => c.status === "ok")

  let testNotification = null
  if (send === "sandbox" || send === "production") {
    testNotification = configOk
      ? await sendAppleTestNotification(send)
      : { skipped: "fix the configuration checks first — Apple would reject the request" }
  }

  return NextResponse.json(
    { ok: configOk, checks, testNotification },
    { headers: { "cache-control": "no-store" } }
  )
}
