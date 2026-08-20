import { describe, expect, it } from "vitest"

import {
  decodeTouch,
  encodeTouch,
  extractReferrerHost,
  normalizePlatform,
  parseAttributionTouch,
  shouldReplaceLatestTouch,
  touchToMeta,
} from "@/lib/analytics/attribution"
import {
  ANON_ID_COOKIE,
  FIRST_TOUCH_COOKIE,
  LATEST_TOUCH_COOKIE,
  readAttributionFromCookieHeader,
} from "@/lib/analytics/attributionCookies"

const NOW = new Date("2026-07-23T12:00:00.000Z")

function touchFrom(href: string, referrer?: string | null) {
  return parseAttributionTouch({ url: new URL(href), referrer: referrer ?? null, now: NOW })
}

describe("normalizePlatform", () => {
  it("maps each founder-facing platform from its utm_source aliases", () => {
    expect(normalizePlatform("tiktok")).toBe("tiktok")
    expect(normalizePlatform("TikTok")).toBe("tiktok")
    expect(normalizePlatform("tik_tok")).toBe("tiktok")
    expect(normalizePlatform("ig")).toBe("instagram")
    expect(normalizePlatform("fb")).toBe("facebook")
    expect(normalizePlatform("twitter")).toBe("x")
    expect(normalizePlatform("x")).toBe("x")
    expect(normalizePlatform("yt")).toBe("youtube")
    expect(normalizePlatform("discord")).toBe("discord")
  })

  it("falls back to the referrer host only when utm_source is absent", () => {
    expect(normalizePlatform(null, "m.tiktok.com")).toBe("tiktok")
    expect(normalizePlatform(null, "t.co")).toBe("x")
    // An explicit utm_source always wins — that is what the founder controls.
    expect(normalizePlatform("instagram", "tiktok.com")).toBe("instagram")
  })

  it("does not match a host that merely ends with a platform name as a substring", () => {
    expect(normalizePlatform(null, "nottiktok.example")).toBe("other")
    expect(normalizePlatform(null, "tiktok.com.evil.example")).toBe("other")
  })

  it("distinguishes an unrecognized real source from genuinely direct traffic", () => {
    // Collapsing these together would understate campaign traffic and overstate organic.
    expect(normalizePlatform("some-new-network")).toBe("other")
    expect(normalizePlatform(null, "news.ycombinator.com")).toBe("other")
    expect(normalizePlatform(null, null)).toBe("direct")
  })
})

describe("extractReferrerHost", () => {
  it("returns the bare host and ignores same-origin navigation", () => {
    expect(extractReferrerHost("https://www.tiktok.com/@af/video/123")).toBe("tiktok.com")
    expect(extractReferrerHost("https://allfantasy.ai/start", "allfantasy.ai")).toBeNull()
    expect(extractReferrerHost("not-a-url")).toBeNull()
    expect(extractReferrerHost(null)).toBeNull()
  })

  it("never retains the referrer path or query, which can carry PII", () => {
    const host = extractReferrerHost("https://mail.example.com/inbox?token=secret-value&email=a@b.com")
    expect(host).toBe("mail.example.com")
    expect(host).not.toContain("secret-value")
    expect(host).not.toContain("a@b.com")
  })
})

describe("parseAttributionTouch", () => {
  it("captures a full tracked link", () => {
    const touch = touchFrom(
      "https://allfantasy.ai/start?utm_source=tiktok&utm_medium=social&utm_campaign=launch&utm_content=carousel-3&utm_term=dynasty&af_cid=camp_99&ref=CIEGE",
    )

    expect(touch).toMatchObject({
      platform: "tiktok",
      source: "tiktok",
      medium: "social",
      campaign: "launch",
      content: "carousel-3",
      term: "dynasty",
      campaignId: "camp_99",
      referralCode: "CIEGE",
      landingPath: "/start",
      at: NOW.toISOString(),
    })
  })

  it("returns null for an ordinary internal navigation so a real touch is never overwritten", () => {
    expect(touchFrom("https://allfantasy.ai/dashboard")).toBeNull()
    expect(touchFrom("https://allfantasy.ai/dashboard?tab=leagues")).toBeNull()
    expect(touchFrom("https://allfantasy.ai/dashboard", "https://allfantasy.ai/start")).toBeNull()
  })

  it("records an external referrer even with no UTM parameters", () => {
    const touch = touchFrom("https://allfantasy.ai/", "https://www.reddit.com/r/fantasyfootball/")
    expect(touch).toMatchObject({ platform: "reddit", source: null, referrerHost: "reddit.com" })
  })

  it("truncates oversized values so a hostile query cannot bloat the cookie", () => {
    const touch = touchFrom(`https://allfantasy.ai/?utm_campaign=${"x".repeat(5000)}`)
    expect(touch?.campaign?.length).toBe(120)
  })
})

describe("first-touch vs latest-touch precedence", () => {
  it("keeps a tracked campaign when a later visit arrives from a bare referrer", () => {
    const campaign = touchFrom("https://allfantasy.ai/?utm_source=tiktok&utm_campaign=launch")!
    const bareReferrer = touchFrom("https://allfantasy.ai/", "https://www.google.com/")!

    expect(shouldReplaceLatestTouch(campaign, bareReferrer)).toBe(false)
    expect(shouldReplaceLatestTouch(campaign, touchFrom("https://allfantasy.ai/?utm_source=instagram")!)).toBe(true)
    expect(shouldReplaceLatestTouch(null, bareReferrer)).toBe(true)
  })
})

describe("touch encoding", () => {
  it("round-trips every field", () => {
    const touch = touchFrom(
      "https://allfantasy.ai/start?utm_source=youtube&utm_medium=video&utm_campaign=c&utm_content=ct&utm_term=t&af_cid=id1&ref=R1",
    )!
    expect(decodeTouch(encodeTouch(touch))).toEqual(touch)
  })

  it("survives values containing separators that would break naive parsing", () => {
    const touch = touchFrom("https://allfantasy.ai/?utm_campaign=a%3Db%3Bc%2Cd&utm_source=tiktok")!
    expect(touch.campaign).toBe("a=b;c,d")
    expect(decodeTouch(encodeTouch(touch))?.campaign).toBe("a=b;c,d")
  })

  it("returns null rather than throwing on corrupt input", () => {
    expect(decodeTouch("not-json")).toBeNull()
    expect(decodeTouch("%7Bbroken")).toBeNull()
    expect(decodeTouch(null)).toBeNull()
    expect(decodeTouch("")).toBeNull()
  })

  it("coerces an unknown platform to `other` instead of trusting the cookie value", () => {
    const forged = encodeURIComponent(JSON.stringify({ p: "admin-platform", s: "x" }))
    expect(decodeTouch(forged)?.platform).toBe("other")
  })

  it("decodes the DOUBLE-encoded form a real browser actually sends", () => {
    // Captured verbatim from a live Set-Cookie header (dev server, tracked TikTok link).
    // encodeTouch percent-encodes, then NextResponse.cookies.set() encodes again. Readers
    // that parse the RAW Cookie header (e.g. /api/analytics/track) therefore see two
    // layers, while request.cookies.get() readers see one. A single fixed decode passes
    // the one-layer case and silently fails the two-layer case — which is exactly the
    // regression this asserts against, since the earlier fixture was single-encoded and
    // did not match reality.
    const fromWire =
      "%257B%2522p%2522%253A%2522tiktok%2522%252C%2522s%2522%253A%2522tiktok%2522%252C" +
      "%2522c%2522%253A%2522launch_a%2522%252C%2522lp%2522%253A%2522%252F%2522%252C" +
      "%2522at%2522%253A%25222026-07-24T00%253A34%253A11.446Z%2522%257D"

    const touch = decodeTouch(fromWire)
    expect(touch).toMatchObject({ platform: "tiktok", source: "tiktok", campaign: "launch_a", landingPath: "/" })
  })

  it("decodes single-encoded and already-plain JSON identically", () => {
    const plain = JSON.stringify({ p: "instagram", s: "instagram", c: "retarget" })
    expect(decodeTouch(plain)?.campaign).toBe("retarget")
    expect(decodeTouch(encodeURIComponent(plain))?.campaign).toBe("retarget")
    expect(decodeTouch(encodeURIComponent(encodeURIComponent(plain)))?.campaign).toBe("retarget")
  })

  it("still rejects garbage rather than looping on it", () => {
    expect(decodeTouch("%25%25%25not-json")).toBeNull()
    expect(decodeTouch("plain garbage")).toBeNull()
  })
})

describe("touchToMeta", () => {
  it("namespaces first and latest touch so both survive in one payload", () => {
    const first = touchFrom("https://allfantasy.ai/?utm_source=tiktok&utm_campaign=launch")!
    const latest = touchFrom("https://allfantasy.ai/?utm_source=instagram&utm_campaign=retarget")!

    const meta = { ...touchToMeta(first, "first"), ...touchToMeta(latest, "latest") }

    expect(meta.first_platform).toBe("tiktok")
    expect(meta.first_campaign).toBe("launch")
    expect(meta.latest_platform).toBe("instagram")
    expect(meta.latest_campaign).toBe("retarget")
  })

  it("omits absent fields rather than emitting empty strings", () => {
    const meta = touchToMeta(touchFrom("https://allfantasy.ai/?utm_source=tiktok")!, "first")
    expect(meta).not.toHaveProperty("first_campaign")
    expect(meta).not.toHaveProperty("first_referral_code")
  })
})

describe("readAttributionFromCookieHeader", () => {
  it("reads all three cookies out of a real header", () => {
    const first = touchFrom("https://allfantasy.ai/?utm_source=tiktok&utm_campaign=launch")!
    const latest = touchFrom("https://allfantasy.ai/?utm_source=instagram")!
    const header = [
      `${ANON_ID_COOKIE}=anon-123`,
      `${FIRST_TOUCH_COOKIE}=${encodeTouch(first)}`,
      `${LATEST_TOUCH_COOKIE}=${encodeTouch(latest)}`,
      "other_cookie=ignored",
    ].join("; ")

    const state = readAttributionFromCookieHeader(header)
    expect(state.anonId).toBe("anon-123")
    expect(state.firstTouch?.campaign).toBe("launch")
    expect(state.latestTouch?.platform).toBe("instagram")
  })

  it("preserves `=` inside an encoded value by splitting on the first separator only", () => {
    const touch = touchFrom("https://allfantasy.ai/?utm_campaign=a%3Db&utm_source=tiktok")!
    const state = readAttributionFromCookieHeader(`${FIRST_TOUCH_COOKIE}=${encodeTouch(touch)}`)
    expect(state.firstTouch?.campaign).toBe("a=b")
  })

  it("returns empty state for a missing or malformed header", () => {
    expect(readAttributionFromCookieHeader(null)).toEqual({ anonId: null, firstTouch: null, latestTouch: null })
    expect(readAttributionFromCookieHeader("=nokey; ;;")).toEqual({
      anonId: null,
      firstTouch: null,
      latestTouch: null,
    })
  })
})
