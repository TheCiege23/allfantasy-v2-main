/**
 * ReferralTrackingResolver — resolve referral code from request (query, cookie) and persist.
 */

import { NextRequest, NextResponse } from "next/server"

const REFERRAL_COOKIE = "af_ref"
const REFERRAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

export function getReferralCodeFromRequest(
  req: NextRequest,
  options?: { includeCookie?: boolean }
): string | null {
  const includeCookie = options?.includeCookie ?? true
  const fromNextUrl = req.nextUrl?.searchParams?.get("ref")
  let fromRawUrl: string | null = null

  if (!fromNextUrl && req.url) {
    try {
      fromRawUrl = new URL(req.url).searchParams.get("ref")
    } catch {
      fromRawUrl = null
    }
  }

  const q = fromNextUrl ?? fromRawUrl
  const code = typeof q === "string" && q.trim() ? q.trim().toUpperCase() : null
  if (code) return code
  if (!includeCookie) return null
  const cookie = req.cookies.get(REFERRAL_COOKIE)?.value
  return typeof cookie === "string" && cookie.trim() ? cookie.trim().toUpperCase() : null
}

export function setReferralCookie(response: NextResponse, code: string): void {
  response.cookies.set(REFERRAL_COOKIE, code, {
    maxAge: REFERRAL_COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  })
}

