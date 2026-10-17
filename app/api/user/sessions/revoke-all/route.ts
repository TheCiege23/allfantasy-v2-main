import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-guard"
import { revokeAllSessionsForUser } from "@/lib/auth/sessionRevocation"
import { buildRateLimit429, consumeRateLimit } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

/**
 * POST /api/user/sessions/revoke-all — "Sign out everywhere" (Settings › Security).
 *
 * Refuses every session this account holds, on every device, INCLUDING the one asking: sessions are
 * stateless JWTs and the revocation is a user-wide "issued before now" line
 * (lib/auth/sessionRevocation), so there is no way to spare the current cookie without re-issuing
 * it from here. The client signs this device out straight after, and the user signs back in.
 *
 * 503 when the revocation was not recorded (Redis down or unset). The module fails open, so in
 * that case the other devices are STILL signed in — the response must say so, never "done".
 */
export async function POST() {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const rl = consumeRateLimit({
    scope: "user",
    action: "revoke_all_sessions",
    sleeperUsername: auth.userId,
    maxRequests: 5,
    windowMs: 15 * 60_000,
  })
  if (!rl.success) {
    return NextResponse.json(buildRateLimit429({ message: "Too many attempts — try again in a few minutes.", rl }), {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfterSec) },
    })
  }

  const recorded = await revokeAllSessionsForUser(auth.userId).catch(() => false)
  if (!recorded) {
    return NextResponse.json(
      {
        error: "NOT_RECORDED",
        message: "We couldn't sign out your other devices right now — they are still signed in. Please try again shortly.",
      },
      { status: 503 },
    )
  }
  return NextResponse.json({ ok: true })
}
