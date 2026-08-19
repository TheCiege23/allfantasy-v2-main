/**
 * The acquisition-funnel emitter. Per the launch decision, admin funnel truth is
 * first-party and server-emitted; these assertions cover the properties that make the
 * resulting campaign numbers trustworthy.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACQUISITION } from "@/lib/analytics/eventNames"
import { encodeTouch, parseAttributionTouch } from "@/lib/analytics/attribution"
import { ANON_ID_COOKIE, FIRST_TOUCH_COOKIE, LATEST_TOUCH_COOKIE } from "@/lib/analytics/attributionCookies"

const mocks = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock("@/lib/prisma", () => ({ prisma: { analyticsEvent: { create: mocks.create } } }))

const NOW = new Date("2026-07-23T12:00:00.000Z")

function touchFor(href: string) {
  return encodeTouch(parseAttributionTouch({ url: new URL(href), referrer: null, now: NOW })!)
}

async function emit(args: {
  event?: string
  userId?: string | null
  jar?: Record<string, string>
  meta?: Record<string, string | number | boolean | null>
}) {
  const { recordFunnelEvent } = await import("@/lib/analytics/recordFunnelEvent")
  return recordFunnelEvent({
    event: args.event ?? ACQUISITION.SIGNUP_COMPLETED,
    userId: args.userId === undefined ? "user-1" : args.userId,
    getCookie: (name) => (args.jar ?? {})[name],
    meta: args.meta,
  })
}

describe("recordFunnelEvent", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.create.mockResolvedValue({})
  })

  it("attaches campaign context and correlates to the anonymous journey", async () => {
    await emit({
      jar: {
        [ANON_ID_COOKIE]: "anon-5",
        [FIRST_TOUCH_COOKIE]: touchFor("https://allfantasy.ai/?utm_source=tiktok&utm_campaign=launch&af_cid=c1"),
        [LATEST_TOUCH_COOKIE]: touchFor("https://allfantasy.ai/?utm_source=instagram"),
      },
      meta: { auth_method: "email" },
    })

    const { data } = mocks.create.mock.calls[0][0]
    expect(data).toMatchObject({
      event: "acquisition.signup_completed",
      userId: "user-1",
      sessionId: "anon-5",
    })
    expect(data.meta).toMatchObject({
      auth_method: "email",
      first_platform: "tiktok",
      first_campaign: "launch",
      first_campaign_id: "c1",
      latest_platform: "instagram",
      has_attribution: true,
    })
  })

  it("marks has_attribution false when cookies were cleared, instead of implying direct traffic", async () => {
    // Treating a cleared cookie as "direct" would inflate direct signups and
    // understate every campaign's conversion count.
    await emit({ jar: { [ANON_ID_COOKIE]: "anon-6" } })

    const { data } = mocks.create.mock.calls[0][0]
    expect(data.meta.has_attribution).toBe(false)
    expect(data.meta).not.toHaveProperty("first_platform")
  })

  it("records a null sessionId rather than synthesizing one when cookies are blocked", async () => {
    await emit({ jar: {} })
    expect(mocks.create.mock.calls[0][0].data.sessionId).toBeNull()
  })

  it("keeps every funnel stage on one canonical name set", () => {
    expect(Object.values(ACQUISITION)).toEqual([
      "acquisition.landing_viewed",
      "acquisition.signup_completed",
      "acquisition.email_verified",
      "acquisition.import_started",
      "acquisition.import_completed",
      "acquisition.dashboard_activated",
    ])
  })

  it("distinguishes auth methods so per-provider conversion is separable", async () => {
    await emit({ meta: { auth_method: "oauth:discord" } })
    expect(mocks.create.mock.calls[0][0].data.meta.auth_method).toBe("oauth:discord")
  })

  it("returns false instead of throwing when the write fails", async () => {
    // These calls sit inside signup and import flows that must not fail on analytics.
    mocks.create.mockRejectedValue(new Error("db down"))
    await expect(emit({})).resolves.toBe(false)
  })

  it("returns true on a successful write", async () => {
    await expect(emit({})).resolves.toBe(true)
  })
})
