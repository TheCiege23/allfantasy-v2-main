import { NextResponse } from "next/server"
import { startPasskeyRegistration } from "@/lib/auth/passkeys"
import { PASSKEY_ERROR_MESSAGES, requestOriginOf, signedInUserId, unavailable } from "@/lib/auth/passkeyRequest"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Step one of adding Face ID / a fingerprint to the signed-in account (lib/auth/passkeys.ts). */
export async function POST(req: Request) {
  const userId = await signedInUserId()
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED", message: "Please sign in again." }, { status: 401 })
  const result = await startPasskeyRegistration(userId, requestOriginOf(req)).catch(() => null)
  if (!result) return unavailable()
  if (!result.ok) {
    const status = result.error === "TOO_MANY" ? 409 : result.error === "NO_USER" ? 401 : 503
    return NextResponse.json({ error: result.error, message: PASSKEY_ERROR_MESSAGES[result.error] }, { status })
  }
  return NextResponse.json({ options: result.options }, { headers: { "Cache-Control": "no-store" } })
}
