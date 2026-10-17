import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { getToken } from "next-auth/jwt"

import { authOptions } from "@/lib/auth"
import { resolveAuthSecret } from "@/lib/auth/resolve-auth-secret"
import { removeIosDevice, saveIosDevice } from "@/lib/push-notifications"
import { apnsConfig, isValidDeviceToken } from "@/lib/push-notifications/apns"

export const dynamic = "force-dynamic"

/**
 * The iOS app's device token (ios-app/, Capacitor push). Mirrors /api/push/subscribe:
 *
 *   GET    → { configured } — whether this server can send to Apple at all. The app only
 *            asks the user for notification permission when the answer is yes, so nobody is
 *            prompted for notifications that can never arrive.
 *   POST   { token } → register this phone for the signed-in user, tied to THIS login's session
 *            id so signing out removes it (lib/auth events.signOut).
 *   DELETE { token } → unregister it.
 */
export async function GET() {
  return NextResponse.json({ configured: apnsConfig() !== null })
}

async function signedInUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const id = session?.user?.id
  return typeof id === "string" && id.trim() ? id : null
}

async function readToken(req: NextRequest): Promise<string | null> {
  const body = (await req.json().catch(() => ({}))) as { token?: unknown }
  return isValidDeviceToken(body.token) ? body.token : null
}

export async function POST(req: NextRequest) {
  const userId = await signedInUserId()
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const token = await readToken(req)
  if (!token) return NextResponse.json({ error: "A valid device token is required" }, { status: 400 })

  const secret = resolveAuthSecret()
  const jwt = secret ? await getToken({ req, secret }).catch(() => null) : null
  const sid = typeof jwt?.sid === "string" ? jwt.sid : null

  const ok = await saveIosDevice(userId, token, sid)
  if (!ok) return NextResponse.json({ error: "Could not register this device" }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const userId = await signedInUserId()
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const token = await readToken(req)
  if (!token) return NextResponse.json({ error: "A valid device token is required" }, { status: 400 })
  await removeIosDevice(userId, token)
  return NextResponse.json({ ok: true })
}
