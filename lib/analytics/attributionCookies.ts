/**
 * Cookie transport for campaign attribution.
 *
 * Cookies — not localStorage — because the journey this must survive is:
 *   tracked link → landing → /start → signup or OAuth → provider redirect →
 *   callback → onboarding → import → dashboard
 *
 * The existing `af_session_id` (app/hooks/useAnalytics.ts) lives in localStorage, so it
 * is invisible to the server and cannot be read during an OAuth callback. These cookies
 * are set server-side in middleware and are httpOnly, so page scripts cannot read or
 * forge them and they are present on every server request in the chain.
 *
 * Edge-safe: only `next/server` types and Web Crypto. No Prisma, no next/headers.
 */
import type { NextRequest, NextResponse } from "next/server"

import {
  type AttributionTouch,
  decodeTouch,
  encodeTouch,
  parseAttributionTouch,
  shouldReplaceLatestTouch,
} from "@/lib/analytics/attribution"

/** Stable anonymous correlation id. Survives OAuth; linked to a user id at sign-in. */
export const ANON_ID_COOKIE = "af_anon_id"
/** First campaign touch. Written once and never overwritten while the cookie survives. */
export const FIRST_TOUCH_COOKIE = "af_attr_first"
/** Most recent campaign touch. */
export const LATEST_TOUCH_COOKIE = "af_attr_last"

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365
const NINETY_DAYS_SECONDS = 60 * 60 * 24 * 90

type CookieOptions = {
  httpOnly: true
  sameSite: "lax"
  secure: boolean
  path: "/"
  maxAge: number
}

/**
 * `sameSite: "lax"` is required, not incidental: OAuth callbacks return via a
 * cross-site top-level navigation, and `strict` would withhold these cookies exactly
 * when the anonymous journey needs to be joined to the new account.
 */
function cookieOptions(maxAge: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  }
}

function newAnonId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  }
}

export type AttributionState = {
  anonId: string | null
  firstTouch: AttributionTouch | null
  latestTouch: AttributionTouch | null
}

/** Generic reader so route handlers (next/headers) and middleware can share one implementation. */
export function readAttributionState(getCookie: (name: string) => string | undefined): AttributionState {
  return {
    anonId: getCookie(ANON_ID_COOKIE) ?? null,
    firstTouch: decodeTouch(getCookie(FIRST_TOUCH_COOKIE)),
    latestTouch: decodeTouch(getCookie(LATEST_TOUCH_COOKIE)),
  }
}

/**
 * Read attribution straight off a raw `Cookie` header, for route handlers typed as
 * plain `Request` (which have no `.cookies` accessor). Values are percent-encoded JSON,
 * so a `=` inside a value is preserved by splitting on the FIRST `=` only.
 */
export function readAttributionFromCookieHeader(header: string | null | undefined): AttributionState {
  const jar = new Map<string, string>()
  for (const part of (header ?? "").split(";")) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    jar.set(trimmed.slice(0, eq), trimmed.slice(eq + 1))
  }
  return readAttributionState((name) => jar.get(name))
}

/**
 * Stamp attribution onto an outgoing middleware response.
 *
 * Applied to EVERY response — including redirects — because tracked links routinely land
 * on a path that immediately redirects (apex→www canonicalization, `/` → `/dashboard` for
 * signed-in users). Capturing only on non-redirect responses would silently drop those.
 *
 * Never throws: attribution is analytics, and a malformed URL or cookie must not be able
 * to take down request routing for the whole site.
 */
export function applyAttributionCapture(
  request: NextRequest,
  response: NextResponse,
  now: Date = new Date(),
): NextResponse {
  try {
    const existingAnonId = request.cookies.get(ANON_ID_COOKIE)?.value
    if (!existingAnonId) {
      response.cookies.set(ANON_ID_COOKIE, newAnonId(), cookieOptions(ONE_YEAR_SECONDS))
    }

    const touch = parseAttributionTouch({
      url: request.nextUrl,
      referrer: request.headers.get("referer"),
      now,
    })
    if (!touch) return response

    // First touch is write-once: a later campaign must never overwrite the source that
    // originally earned this visitor. Both touches are kept, per the attribution contract.
    if (!request.cookies.get(FIRST_TOUCH_COOKIE)?.value) {
      response.cookies.set(FIRST_TOUCH_COOKIE, encodeTouch(touch), cookieOptions(ONE_YEAR_SECONDS))
    }

    const existingLatest = decodeTouch(request.cookies.get(LATEST_TOUCH_COOKIE)?.value)
    if (shouldReplaceLatestTouch(existingLatest, touch)) {
      response.cookies.set(LATEST_TOUCH_COOKIE, encodeTouch(touch), cookieOptions(NINETY_DAYS_SECONDS))
    }

    return response
  } catch {
    return response
  }
}
