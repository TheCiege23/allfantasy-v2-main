/**
 * Behavioral coverage for the middleware capture step — the part that must survive the
 * real journey (tracked link → landing → /start → OAuth redirect → callback → dashboard).
 */
import { describe, expect, it } from "vitest"
import { NextRequest, NextResponse } from "next/server"

import { encodeTouch, parseAttributionTouch } from "@/lib/analytics/attribution"
import {
  ANON_ID_COOKIE,
  FIRST_TOUCH_COOKIE,
  LATEST_TOUCH_COOKIE,
  applyAttributionCapture,
} from "@/lib/analytics/attributionCookies"

const NOW = new Date("2026-07-23T12:00:00.000Z")

function request(href: string, cookies: Record<string, string> = {}, referrer?: string) {
  const headers = new Headers()
  const jar = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")
  if (jar) headers.set("cookie", jar)
  if (referrer) headers.set("referer", referrer)
  return new NextRequest(new URL(href), { headers })
}

function setCookieValue(res: NextResponse, name: string) {
  return res.cookies.get(name)?.value
}

function touchFor(href: string) {
  return parseAttributionTouch({ url: new URL(href), referrer: null, now: NOW })!
}

describe("applyAttributionCapture", () => {
  it("issues an anonymous id on first contact and does not reissue it later", () => {
    const fresh = applyAttributionCapture(request("https://allfantasy.ai/"), NextResponse.next(), NOW)
    const anonId = setCookieValue(fresh, ANON_ID_COOKIE)
    expect(anonId).toBeTruthy()

    const returning = applyAttributionCapture(
      request("https://allfantasy.ai/", { [ANON_ID_COOKIE]: "existing-anon" }),
      NextResponse.next(),
      NOW,
    )
    // Re-issuing would sever the anonymous journey from everything recorded before it.
    expect(setCookieValue(returning, ANON_ID_COOKIE)).toBeUndefined()
  })

  it("records first and latest touch for a tracked link", () => {
    const res = applyAttributionCapture(
      request("https://allfantasy.ai/start?utm_source=tiktok&utm_campaign=launch&utm_content=slide-3"),
      NextResponse.next(),
      NOW,
    )

    expect(setCookieValue(res, FIRST_TOUCH_COOKIE)).toBeTruthy()
    expect(setCookieValue(res, LATEST_TOUCH_COOKIE)).toBeTruthy()
  })

  it("never overwrites an existing first touch when a second campaign arrives", () => {
    const original = encodeTouch(touchFor("https://allfantasy.ai/?utm_source=tiktok&utm_campaign=launch"))

    const res = applyAttributionCapture(
      request("https://allfantasy.ai/?utm_source=instagram&utm_campaign=retarget", {
        [ANON_ID_COOKIE]: "anon-1",
        [FIRST_TOUCH_COOKIE]: original,
      }),
      NextResponse.next(),
      NOW,
    )

    // First touch untouched; latest touch advances. Both are required by the contract.
    expect(setCookieValue(res, FIRST_TOUCH_COOKIE)).toBeUndefined()
    expect(setCookieValue(res, LATEST_TOUCH_COOKIE)).toBeTruthy()
  })

  it("writes nothing on an ordinary internal navigation", () => {
    const res = applyAttributionCapture(
      request("https://allfantasy.ai/dashboard?tab=leagues", {
        [ANON_ID_COOKIE]: "anon-1",
        [FIRST_TOUCH_COOKIE]: encodeTouch(touchFor("https://allfantasy.ai/?utm_source=tiktok")),
      }),
      NextResponse.next(),
      NOW,
    )

    expect(setCookieValue(res, FIRST_TOUCH_COOKIE)).toBeUndefined()
    expect(setCookieValue(res, LATEST_TOUCH_COOKIE)).toBeUndefined()
  })

  it("stamps attribution onto a REDIRECT response", () => {
    // Tracked links routinely land on a redirecting path (apex→www, `/`→`/dashboard`).
    // Capturing only on NextResponse.next() would silently drop those campaigns.
    const redirect = NextResponse.redirect(new URL("https://allfantasy.ai/dashboard"))
    const res = applyAttributionCapture(
      request("https://allfantasy.ai/?utm_source=tiktok&utm_campaign=launch"),
      redirect,
      NOW,
    )

    expect(setCookieValue(res, ANON_ID_COOKIE)).toBeTruthy()
    expect(setCookieValue(res, FIRST_TOUCH_COOKIE)).toBeTruthy()
  })

  it("sets cookies that can survive an OAuth callback", () => {
    const res = applyAttributionCapture(
      request("https://allfantasy.ai/?utm_source=tiktok"),
      NextResponse.next(),
      NOW,
    )
    const cookie = res.cookies.get(FIRST_TOUCH_COOKIE)

    // SameSite=Strict would withhold the cookie on the cross-site top-level navigation
    // back from the OAuth provider — exactly when the journey must be joined to the account.
    expect(cookie?.sameSite).toBe("lax")
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.path).toBe("/")
  })

  it("recovers from a corrupt cookie instead of throwing into request routing", () => {
    expect(() =>
      applyAttributionCapture(
        request("https://allfantasy.ai/?utm_source=tiktok", {
          [ANON_ID_COOKIE]: "anon-1",
          [LATEST_TOUCH_COOKIE]: "%7Bnot-json",
        }),
        NextResponse.next(),
        NOW,
      ),
    ).not.toThrow()
  })

  it("keeps a tracked campaign as latest touch when the visitor returns via a search engine", () => {
    const campaign = encodeTouch(touchFor("https://allfantasy.ai/?utm_source=tiktok&utm_campaign=launch"))

    const res = applyAttributionCapture(
      request(
        "https://allfantasy.ai/",
        { [ANON_ID_COOKIE]: "anon-1", [FIRST_TOUCH_COOKIE]: campaign, [LATEST_TOUCH_COOKIE]: campaign },
        "https://www.google.com/",
      ),
      NextResponse.next(),
      NOW,
    )

    expect(setCookieValue(res, LATEST_TOUCH_COOKIE)).toBeUndefined()
  })
})
