/**
 * /api/analytics/track is the ingestion point for the authenticated funnel that admin
 * campaign reporting is derived from. Two properties are load-bearing and regression-
 * tested here:
 *
 *  1. userId comes from the server session ONLY. It previously read
 *     `body.userId || session.user.id`, letting any anonymous caller attribute events to
 *     any user — silently fabricating signups/activations/conversions in the admin panel.
 *  2. Campaign attribution comes from httpOnly cookies set server-side in middleware,
 *     never from the request body, so a client cannot claim a campaign it did not arrive
 *     through.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { encodeTouch, parseAttributionTouch } from "@/lib/analytics/attribution"
import { ANON_ID_COOKIE, FIRST_TOUCH_COOKIE, LATEST_TOUCH_COOKIE } from "@/lib/analytics/attributionCookies"

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  getServerSession: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: { analyticsEvent: { create: mocks.create } } }))
vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/telemetry/usage", () => ({
  withApiUsage: () => (handler: unknown) => handler,
}))

const NOW = new Date("2026-07-23T12:00:00.000Z")

function touchFor(href: string) {
  return encodeTouch(parseAttributionTouch({ url: new URL(href), referrer: null, now: NOW })!)
}

function post(body: unknown, cookies: Record<string, string> = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  const jar = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")
  if (jar) headers.cookie = jar
  return new Request("https://allfantasy.ai/api/analytics/track", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
}

async function callRoute(req: Request) {
  const { POST } = await import("@/app/api/analytics/track/route")
  return (POST as unknown as (r: Request) => Promise<Response>)(req)
}

describe("/api/analytics/track — identity", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.create.mockResolvedValue({})
    mocks.getServerSession.mockResolvedValue(null)
  })

  it("ignores a client-supplied userId for an anonymous caller", async () => {
    await callRoute(post({ event: "signup_completed", userId: "victim-user-id" }))

    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create.mock.calls[0][0].data.userId).toBeNull()
  })

  it("ignores a client-supplied userId even when it conflicts with the real session", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { id: "real-user" } })

    await callRoute(post({ event: "paid_conversion", userId: "someone-else" }))

    expect(mocks.create.mock.calls[0][0].data.userId).toBe("real-user")
  })

  it("attributes the event to the authenticated session user", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-42" } })

    await callRoute(post({ event: "dashboard_activated" }))

    expect(mocks.create.mock.calls[0][0].data.userId).toBe("user-42")
  })
})

describe("/api/analytics/track — attribution", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.create.mockResolvedValue({})
    mocks.getServerSession.mockResolvedValue(null)
  })

  it("derives campaign context from cookies, not the request body", async () => {
    await callRoute(
      post({ event: "signup_started" }, {
        [ANON_ID_COOKIE]: "anon-77",
        [FIRST_TOUCH_COOKIE]: touchFor("https://allfantasy.ai/?utm_source=tiktok&utm_campaign=launch"),
        [LATEST_TOUCH_COOKIE]: touchFor("https://allfantasy.ai/?utm_source=instagram&utm_campaign=retarget"),
      }),
    )

    const { data } = mocks.create.mock.calls[0][0]
    expect(data.sessionId).toBe("anon-77")
    expect(data.meta).toMatchObject({
      first_platform: "tiktok",
      first_campaign: "launch",
      latest_platform: "instagram",
      latest_campaign: "retarget",
    })
  })

  it("does not let client meta shadow server-derived attribution", async () => {
    await callRoute(
      post(
        { event: "signup_started", meta: { first_platform: "forged", first_campaign: "forged" } },
        { [FIRST_TOUCH_COOKIE]: touchFor("https://allfantasy.ai/?utm_source=tiktok&utm_campaign=launch") },
      ),
    )

    const { data } = mocks.create.mock.calls[0][0]
    expect(data.meta.first_platform).toBe("tiktok")
    expect(data.meta.first_campaign).toBe("launch")
  })

  it("preserves unrelated client meta", async () => {
    await callRoute(post({ event: "player_search", meta: { query_length: 4 } }))
    expect(mocks.create.mock.calls[0][0].data.meta).toMatchObject({ query_length: 4 })
  })

  it("emits no campaign fields at all when there is no attribution cookie", async () => {
    // A visitor with no campaign must not be recorded as a fabricated "direct" campaign.
    await callRoute(post({ event: "landing_view" }))

    const { data } = mocks.create.mock.calls[0][0]
    expect(data.meta).not.toHaveProperty("first_platform")
    expect(data.meta).not.toHaveProperty("latest_platform")
  })

  it("reads the DOUBLE-encoded cookie a real browser sends, not just the test-shaped one", async () => {
    // Regression: this route parses the RAW Cookie header, so it sees BOTH encoding layers
    // (encodeTouch + NextResponse.cookies.set). The original fixture here was
    // single-encoded, so it passed while the live route silently recorded every event with
    // no campaign fields — indistinguishable from real direct traffic. Value below is
    // verbatim from a live Set-Cookie header.
    const fromWire =
      "%257B%2522p%2522%253A%2522tiktok%2522%252C%2522s%2522%253A%2522tiktok%2522%252C" +
      "%2522c%2522%253A%2522launch_a%2522%252C%2522lp%2522%253A%2522%252F%2522%252C" +
      "%2522at%2522%253A%25222026-07-24T00%253A34%253A11.446Z%2522%257D"

    await callRoute(post({ event: "landing_view" }, { [FIRST_TOUCH_COOKIE]: fromWire }))

    const { data } = mocks.create.mock.calls[0][0]
    expect(data.meta.first_platform).toBe("tiktok")
    expect(data.meta.first_campaign).toBe("launch_a")
  })

  it("prefers the server-set anonymous id over a client-supplied sessionId", async () => {
    await callRoute(post({ event: "landing_view", sessionId: "client-claimed" }, { [ANON_ID_COOKIE]: "anon-9" }))
    expect(mocks.create.mock.calls[0][0].data.sessionId).toBe("anon-9")
  })

  it("falls back to the client sessionId only when no cookie is present", async () => {
    await callRoute(post({ event: "landing_view", sessionId: "client-only" }))
    expect(mocks.create.mock.calls[0][0].data.sessionId).toBe("client-only")
  })
})
