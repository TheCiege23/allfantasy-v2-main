import { NextResponse } from "next/server"
import { getClientIp, rateLimit } from "@/lib/rate-limit"
import { startPasskeySignIn } from "@/lib/auth/passkeys"
import { PASSKEY_ERROR_MESSAGES, requestOriginOf, unavailable } from "@/lib/auth/passkeyRequest"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Step one of "Sign in with Face ID". Public: nobody is signed in yet. Each call writes one
 * short-lived challenge row, so it is rate-limited per IP; step two is the `passkey` provider.
 */
export async function POST(req: Request) {
  const ip = getClientIp(req)
  if (!rateLimit(`passkey-signin-options:${ip}`, 20, 60_000).success) {
    return NextResponse.json({ error: "RATE_LIMITED", message: "Please wait a minute and try again." }, { status: 429 })
  }
  const result = await startPasskeySignIn(requestOriginOf(req)).catch(() => null)
  if (!result) return unavailable()
  if (!result.ok) return NextResponse.json({ error: result.error, message: PASSKEY_ERROR_MESSAGES[result.error] }, { status: 503 })
  return NextResponse.json({ options: result.options }, { headers: { "Cache-Control": "no-store" } })
}
