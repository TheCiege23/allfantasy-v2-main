/**
 * The anonymous journey → account join. This is the row admin campaign reporting reads to
 * attribute a confirmed account back to the tracked link that earned it, so its
 * idempotency and its honest-unknown behavior are both load-bearing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { encodeTouch, parseAttributionTouch } from "@/lib/analytics/attribution"
import { ANON_ID_COOKIE, FIRST_TOUCH_COOKIE, LATEST_TOUCH_COOKIE } from "@/lib/analytics/attributionCookies"

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), create: vi.fn() }))

vi.mock("@/lib/prisma", () => ({
  prisma: { analyticsEvent: { findFirst: mocks.findFirst, create: mocks.create } },
}))

const NOW = new Date("2026-07-23T12:00:00.000Z")

function touchFor(href: string) {
  return encodeTouch(parseAttributionTouch({ url: new URL(href), referrer: null, now: NOW })!)
}

function cookieReader(jar: Record<string, string>) {
  return (name: string) => jar[name]
}

async function link(jar: Record<string, string>, userId = "user-1") {
  const { linkAttributionToUser } = await import("@/lib/analytics/linkAttributionToUser")
  return linkAttributionToUser({ userId, getCookie: cookieReader(jar) })
}

describe("linkAttributionToUser", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.findFirst.mockResolvedValue(null)
    mocks.create.mockResolvedValue({})
  })

  it("records the anon→user join with both touches", async () => {
    const result = await link({
      [ANON_ID_COOKIE]: "anon-1",
      [FIRST_TOUCH_COOKIE]: touchFor("https://allfantasy.ai/?utm_source=tiktok&utm_campaign=launch"),
      [LATEST_TOUCH_COOKIE]: touchFor("https://allfantasy.ai/?utm_source=instagram&utm_campaign=retarget"),
    })

    expect(result).toEqual({ status: "linked" })
    const { data } = mocks.create.mock.calls[0][0]
    expect(data).toMatchObject({ event: "auth.attribution_linked", userId: "user-1", sessionId: "anon-1" })
    expect(data.meta).toMatchObject({
      first_platform: "tiktok",
      first_campaign: "launch",
      latest_platform: "instagram",
      has_attribution: true,
    })
  })

  it("does not write a second row for a repeat login on the same device", async () => {
    // signIn fires on EVERY login; writing unconditionally would inflate every
    // campaign's conversion count by one per session.
    mocks.findFirst.mockResolvedValue({ id: "existing" })

    expect(await link({ [ANON_ID_COOKIE]: "anon-1" })).toEqual({
      status: "skipped",
      reason: "already_linked",
    })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("scopes idempotency to the (user, anon id) pair so a new device links again", async () => {
    await link({ [ANON_ID_COOKIE]: "anon-2" })
    expect(mocks.findFirst.mock.calls[0][0].where).toMatchObject({
      event: "auth.attribution_linked",
      userId: "user-1",
      sessionId: "anon-2",
    })
  })

  it("writes nothing when there is no anonymous id to join", async () => {
    expect(await link({})).toEqual({ status: "skipped", reason: "no_anon_id" })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("distinguishes 'no campaign' from 'campaign unknown' via has_attribution", async () => {
    await link({ [ANON_ID_COOKIE]: "anon-3" })

    const { data } = mocks.create.mock.calls[0][0]
    expect(data.meta.has_attribution).toBe(false)
    expect(data.meta).not.toHaveProperty("first_platform")
  })

  it("never throws when the database write fails, so sign-in is not blocked", async () => {
    mocks.create.mockRejectedValue(new Error("db down"))

    await expect(link({ [ANON_ID_COOKIE]: "anon-4" })).resolves.toEqual({ status: "failed" })
  })

  it("never throws when the lookup itself fails", async () => {
    mocks.findFirst.mockRejectedValue(new Error("db down"))

    await expect(link({ [ANON_ID_COOKIE]: "anon-5" })).resolves.toEqual({ status: "failed" })
  })
})
