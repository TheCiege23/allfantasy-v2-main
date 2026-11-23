import { NextResponse } from "next/server"
import { finishPasskeyRegistration } from "@/lib/auth/passkeys"
import { PASSKEY_ERROR_MESSAGES, requestOriginOf, signedInUserId, unavailable } from "@/lib/auth/passkeyRequest"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Step two of adding a passkey: checks what the device made and saves its public key. */
export async function POST(req: Request) {
  const userId = await signedInUserId()
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED", message: "Please sign in again." }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { response?: unknown } | null
  const result = await finishPasskeyRegistration(userId, body?.response, requestOriginOf(req), req.headers.get("user-agent")).catch(() => null)
  if (!result) return unavailable()
  if (!result.ok) {
    const status = result.error === "ALREADY_ADDED" ? 409 : result.error === "NOT_CONFIGURED" ? 503 : 400
    return NextResponse.json({ error: result.error, message: PASSKEY_ERROR_MESSAGES[result.error] }, { status })
  }
  return NextResponse.json({ ok: true, passkey: result.passkey })
}
