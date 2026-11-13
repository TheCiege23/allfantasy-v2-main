/**
 * Transport for the closed-beta admission token.
 *
 * The raw token is carried in a short-lived, httpOnly, SameSite=Lax cookie set when a
 * visitor opens their invite link (`/api/auth/beta/claim`). Cookies — not a URL param or
 * localStorage — because the token must survive the OAuth provider's cross-site redirect
 * back to the callback, exactly like the Phase-0/1 attribution cookies (also SameSite=Lax).
 * `Strict` would drop it on that top-level cross-site navigation, which is the one moment
 * OAuth admission needs it.
 *
 * httpOnly means page scripts cannot read it, so a reusable raw token never reaches
 * analytics, logs, or client-readable storage. It is consumed on the first successful
 * account creation and cleared immediately after.
 */
import type { NextResponse } from "next/server"

export const BETA_ADMISSION_COOKIE = "af_beta_admission"

/** 30 minutes: long enough to complete signup incl. an OAuth round-trip, short enough to not linger. */
const BETA_ADMISSION_TTL_SECONDS = 30 * 60

type MutableCookies = {
  set(name: string, value: string, options: Record<string, unknown>): void
  delete(name: string): void
}

function baseOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  }
}

/** Set on a NextResponse (used by the claim route). */
export function setAdmissionCookieOnResponse(res: NextResponse, rawToken: string): NextResponse {
  res.cookies.set(BETA_ADMISSION_COOKIE, rawToken, baseOptions(BETA_ADMISSION_TTL_SECONDS))
  return res
}

export function clearAdmissionCookie(store: MutableCookies): void {
  try {
    store.delete(BETA_ADMISSION_COOKIE)
  } catch {
    // deleting an absent cookie is a no-op; never throw into an auth flow
  }
}

