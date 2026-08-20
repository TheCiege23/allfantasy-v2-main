import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { removePushSubscription, savePushSubscription } from "@/lib/push-notifications"
import type { PushSubscriptionInput } from "@/lib/push-notifications/types"

export const dynamic = "force-dynamic"

/**
 * GET /api/push/subscribe
 * Returns whether push is configured server-side and the VAPID public key the browser needs
 * for `PushManager.subscribe`. The PUBLIC key is safe to expose — it is the applicationServerKey
 * every client must present. The PRIVATE key never leaves the server.
 *
 * Served from the API rather than a NEXT_PUBLIC_ env var so that "is push configured" is
 * answered by the same process that would do the sending. A build-time env var can disagree
 * with runtime reality after a config change, and a client that believes push is available
 * when the server cannot send is worse than one that knows it is off.
 */
export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || null
  const privateConfigured = Boolean(process.env.VAPID_PRIVATE_KEY?.trim())
  return NextResponse.json({
    configured: Boolean(publicKey && privateConfigured),
    vapidPublicKey: publicKey,
  })
}

/**
 * POST /api/push/subscribe
 * Register a web push subscription for the current user.
 * Body: { endpoint, keys: { p256dh, auth }, userAgent? }
 */
export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string }
  } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const endpoint = typeof (body as any)?.endpoint === "string" ? (body as any).endpoint : null
  const keys = (body as any)?.keys
  const p256dh = typeof keys?.p256dh === "string" ? keys.p256dh : null
  const auth = typeof keys?.auth === "string" ? keys.auth : null
  const userAgent = typeof (body as any)?.userAgent === "string" ? (body as any).userAgent : undefined

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json(
      { error: "Missing endpoint or keys.p256dh or keys.auth" },
      { status: 400 }
    )
  }

  const input: PushSubscriptionInput = {
    endpoint,
    keys: { p256dh, auth },
    userAgent,
  }

  try {
    const record = await savePushSubscription(userId, input)
    if (!record) {
      return NextResponse.json({ error: "Failed to save subscription" }, { status: 500 })
    }
    return NextResponse.json({ ok: true, id: record.id })
  } catch (e) {
    console.error("[push/subscribe] error:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to subscribe" },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/push/subscribe
 * Remove a subscription when the user turns alerts off, or when the browser reports the
 * endpoint is gone. Body: { endpoint }.
 *
 * Scoped to the caller's own userId: an endpoint is a bearer-ish identifier, and allowing
 * any authenticated user to delete an arbitrary endpoint would let one account silence
 * another's notifications.
 */
export async function DELETE(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string }
  } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const endpoint = typeof (body as any)?.endpoint === "string" ? (body as any).endpoint : null
  if (!endpoint) {
    return NextResponse.json({ error: "Missing endpoint" }, { status: 400 })
  }

  try {
    await removePushSubscription(userId, endpoint)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("[push/subscribe] delete error:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to unsubscribe" },
      { status: 500 }
    )
  }
}
