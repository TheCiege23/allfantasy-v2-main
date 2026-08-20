import { NextResponse } from "next/server"

import { isWellFormedToken } from "@/lib/beta-invite/betaAdmissionService"
import { setAdmissionCookieOnResponse } from "@/lib/beta-invite/betaAdmissionCookie"
import { getClientIp, rateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/auth/beta/claim?token=RAW
 *
 * The URL an admin copies as the invite link. It stores the raw token in the httpOnly
 * admission cookie and redirects to /signup. This is deliberately NOT a validity check:
 * it does not touch the database and does not reveal whether the token is real, expired,
 * or already used — that would be an enumeration oracle. Validity is decided only at the
 * moment of account creation, with an honest error there.
 *
 * The token is never logged. A malformed token still redirects to /signup (with no cookie
 * set); the signup attempt then fails closed with INVITE_REQUIRED, leaking nothing.
 */
export function GET(request: Request) {
  const url = new URL(request.url)

  // Rate-limit per IP (key includes the IP, avoiding the shared-bucket trap) so the claim
  // endpoint cannot be hammered. It reveals nothing about validity, but this bounds abuse.
  const ip = getClientIp(request)
  const rl = rateLimit(`beta-claim:${ip}`, 30, 600_000)
  if (!rl.success) {
    return NextResponse.redirect(new URL("/signup?beta=1", url.origin))
  }

  const token = (url.searchParams.get("token") ?? "").trim()

  const redirect = NextResponse.redirect(new URL("/signup?beta=1", url.origin))

  if (token && isWellFormedToken(token)) {
    setAdmissionCookieOnResponse(redirect, token)
  }
  return redirect
}
