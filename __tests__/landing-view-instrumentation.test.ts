/**
 * landing_viewed admission control.
 *
 * A landing beacon is the one funnel event a caller can fire freely, so every assertion
 * here is about the SERVER refusing to let the number be inflated or poisoned.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACQUISITION } from "@/lib/analytics/eventNames"
import { encodeTouch, parseAttributionTouch } from "@/lib/analytics/attribution"
import { ANON_ID_COOKIE, FIRST_TOUCH_COOKIE, LATEST_TOUCH_COOKIE } from "@/lib/analytics/attributionCookies"
import {
  LANDING_VIEW_DEDUPE_COOKIE,
  LANDING_VIEW_DEDUPE_WINDOW_SECONDS,
  decideLandingView,
  sanitizeLandingMeta,
} from "@/lib/analytics/landingView"

const mocks = vi.hoisted(() => ({ create: vi.fn(), getServerSession: vi.fn() }))

vi.mock("@/lib/prisma", () => ({ prisma: { analyticsEvent: { create: mocks.create } } }))
vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/telemetry/usage", () => ({ withApiUsage: () => (h: unknown) => h }))

const NOW = new Date("2026-07-24T12:00:00.000Z")

function touchFor(href: string) {
  return encodeTouch(parseAttributionTouch({ url: new URL(href), referrer: null, now: NOW })!)
}

function post(body: unknown, cookies: Record<string, string> = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  const jar = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ")
  if (jar) headers.cookie = jar
  return new Request("https://allfantasy.ai/api/analytics/track", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
}

async function callRoute(request: Request) {
  const { POST } = await import("@/app/api/analytics/track/route")
  return (POST as unknown as (r: Request) => Promise<Response>)(request)
}

function landing(cookies: Record<string, string> = {}, meta: unknown = { landing_path: "/" }) {
  return post({ event: ACQUISITION.LANDING_VIEWED, meta }, cookies)
}

const TIKTOK = touchFor("https://allfantasy.ai/?utm_source=tiktok&utm_campaign=launch_a&utm_content=slide-3")
const INSTAGRAM = touchFor("https://allfantasy.ai/?utm_source=instagram&utm_campaign=ig_b")
const X_TOUCH = touchFor("https://allfantasy.ai/?utm_source=twitter&utm_campaign=x_c")

describe("decideLandingView", () => {
  it("drops a beacon with no server-issued anonymous id", () => {
    // A bot or scripted POST straight at the API never loaded a page, so it has no cookie.
    expect(decideLandingView({ anonId: null, dedupeCookie: undefined })).toEqual({
      accept: false,
      reason: "no_anon_id",
    })
  })

  it("drops a duplicate inside the window", () => {
    expect(decideLandingView({ anonId: "anon-1", dedupeCookie: "2026-07-24T12:00:00.000Z" })).toEqual({
      accept: false,
      reason: "duplicate_in_window",
    })
  })

  it("accepts a first view from a real visitor", () => {
    expect(decideLandingView({ anonId: "anon-1", dedupeCookie: undefined })).toEqual({ accept: true })
  })

  it("uses an intentional 30-minute window", () => {
    expect(LANDING_VIEW_DEDUPE_WINDOW_SECONDS).toBe(1800)
  })
})

describe("sanitizeLandingMeta", () => {
  it("keeps only the pathname and discards the query string entirely", () => {
    // Dropping the whole query beats allowlisting safe keys — an allowlist still leaks the
    // next unanticipated one (a reset token, an email in a share link).
    const meta = sanitizeLandingMeta({
      landing_path: "/start?email=victim@example.com&token=secret-abc&utm_source=tiktok",
    })
    expect(meta.landing_path).toBe("/start")
    expect(JSON.stringify(meta)).not.toContain("victim@example.com")
    expect(JSON.stringify(meta)).not.toContain("secret-abc")
  })

  it("discards unknown keys", () => {
    const meta = sanitizeLandingMeta({ landing_path: "/", evil: "x", userId: "someone", password: "p" })
    expect(Object.keys(meta)).toEqual(["landing_path"])
  })

  it("bounds an oversized path", () => {
    expect(sanitizeLandingMeta({ landing_path: `/${"x".repeat(5000)}` }).landing_path!.length).toBe(120)
  })

  it("returns an empty object for junk input", () => {
    expect(sanitizeLandingMeta(null)).toEqual({})
    expect(sanitizeLandingMeta("nope")).toEqual({})
  })
})

describe("/api/analytics/track — landing_viewed", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.create.mockResolvedValue({})
    mocks.getServerSession.mockResolvedValue(null)
  })

  it("records a TikTok tracked landing with first-touch campaign context", async () => {
    await callRoute(landing({ [ANON_ID_COOKIE]: "anon-1", [FIRST_TOUCH_COOKIE]: TIKTOK }))

    const { data } = mocks.create.mock.calls[0][0]
    expect(data.event).toBe("acquisition.landing_viewed")
    expect(data.sessionId).toBe("anon-1")
    expect(data.meta).toMatchObject({ first_platform: "tiktok", first_campaign: "launch_a" })
  })

  it("records an Instagram tracked landing", async () => {
    await callRoute(landing({ [ANON_ID_COOKIE]: "anon-2", [FIRST_TOUCH_COOKIE]: INSTAGRAM }))
    expect(mocks.create.mock.calls[0][0].data.meta.first_platform).toBe("instagram")
  })

  it("records an X tracked landing under the canonical platform name", async () => {
    await callRoute(landing({ [ANON_ID_COOKIE]: "anon-3", [FIRST_TOUCH_COOKIE]: X_TOUCH }))
    expect(mocks.create.mock.calls[0][0].data.meta.first_platform).toBe("x")
  })

  it("records a direct landing without fabricating a campaign", async () => {
    await callRoute(landing({ [ANON_ID_COOKIE]: "anon-4" }))

    const { data } = mocks.create.mock.calls[0][0]
    expect(data.sessionId).toBe("anon-4")
    expect(data.meta).not.toHaveProperty("first_platform")
  })

  it("preserves first touch while reporting the newer latest touch", async () => {
    await callRoute(
      landing({ [ANON_ID_COOKIE]: "anon-5", [FIRST_TOUCH_COOKIE]: TIKTOK, [LATEST_TOUCH_COOKIE]: INSTAGRAM }),
    )

    const { data } = mocks.create.mock.calls[0][0]
    expect(data.meta.first_platform).toBe("tiktok")
    expect(data.meta.latest_platform).toBe("instagram")
  })

  it("suppresses a duplicate view inside the window (rerenders, reloads, extra tabs)", async () => {
    await callRoute(
      landing({ [ANON_ID_COOKIE]: "anon-6", [LANDING_VIEW_DEDUPE_COOKIE]: "2026-07-24T11:59:00.000Z" }),
    )
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("drops a beacon from a caller with no anonymous id", async () => {
    await callRoute(landing({}))
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("reports a drop as ok:true so the mechanism is not disclosed to a prober", async () => {
    const res = await callRoute(landing({}))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, dropped: true })
  })

  it("sets the dedupe cookie only after a successful write", async () => {
    const res = await callRoute(landing({ [ANON_ID_COOKIE]: "anon-7" }))
    const setCookie = res.headers.get("set-cookie") ?? ""

    expect(setCookie).toContain(LANDING_VIEW_DEDUPE_COOKIE)
    expect(setCookie.toLowerCase()).toContain("httponly")
  })

  it("does not set the dedupe cookie when the write fails, so the visit is not lost", async () => {
    mocks.create.mockRejectedValue(new Error("db down"))

    const res = await callRoute(landing({ [ANON_ID_COOKIE]: "anon-8" }))
    expect(res.headers.get("set-cookie") ?? "").not.toContain(LANDING_VIEW_DEDUPE_COOKIE)
  })

  it("never fails the request when analytics persistence fails", async () => {
    mocks.create.mockRejectedValue(new Error("db down"))

    const res = await callRoute(landing({ [ANON_ID_COOKIE]: "anon-9" }))
    expect(res.status).toBe(200)
  })

  it("ignores a caller-supplied userId on a landing beacon", async () => {
    await callRoute(
      post({ event: ACQUISITION.LANDING_VIEWED, userId: "victim", meta: { landing_path: "/" } }, { [ANON_ID_COOKIE]: "anon-10" }),
    )
    expect(mocks.create.mock.calls[0][0].data.userId).toBeNull()
  })

  it("strips a query string a client tries to smuggle through landing_path", async () => {
    await callRoute(
      landing({ [ANON_ID_COOKIE]: "anon-11" }, { landing_path: "/?token=secret-abc&email=a@b.com" }),
    )

    const serialized = JSON.stringify(mocks.create.mock.calls[0][0].data.meta)
    expect(serialized).not.toContain("secret-abc")
    expect(serialized).not.toContain("a@b.com")
  })

  it("does not apply landing dedup to other events", async () => {
    // A dedupe cookie present for a different event must not suppress that event.
    await callRoute(post({ event: "some.other_event" }, { [ANON_ID_COOKIE]: "anon-12", [LANDING_VIEW_DEDUPE_COOKIE]: "x" }))
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
})
