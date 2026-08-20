/**
 * dashboard_activated semantics.
 *
 * Activation is the metric campaigns are ultimately judged on, so the assertions here are
 * mostly about what must NOT count: unknown context, empty dashboards, repeat visits, and
 * any identity the caller could influence.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { encodeTouch, parseAttributionTouch } from "@/lib/analytics/attribution"
import { ANON_ID_COOKIE, FIRST_TOUCH_COOKIE, LATEST_TOUCH_COOKIE } from "@/lib/analytics/attributionCookies"

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), create: vi.fn() }))

vi.mock("@/lib/prisma", () => ({
  prisma: { analyticsEvent: { findFirst: mocks.findFirst, create: mocks.create } },
}))

const NOW = new Date("2026-07-24T12:00:00.000Z")

function touchFor(href: string) {
  return encodeTouch(parseAttributionTouch({ url: new URL(href), referrer: null, now: NOW })!)
}

async function activate(args: { userId?: string; leagueCount: number | null; jar?: Record<string, string> }) {
  const { recordDashboardActivation } = await import("@/lib/analytics/recordDashboardActivation")
  return recordDashboardActivation({
    userId: args.userId ?? "user-1",
    leagueCount: args.leagueCount,
    getCookie: (name) => (args.jar ?? {})[name],
  })
}

describe("recordDashboardActivation", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.findFirst.mockResolvedValue(null)
    mocks.create.mockResolvedValue({})
  })

  it("activates on a successful load with usable league context", async () => {
    const result = await activate({ leagueCount: 3, jar: { [ANON_ID_COOKIE]: "anon-1" } })

    expect(result).toEqual({ status: "recorded" })
    const { data } = mocks.create.mock.calls[0][0]
    expect(data).toMatchObject({
      event: "acquisition.dashboard_activated",
      userId: "user-1",
      sessionId: "anon-1",
    })
    expect(data.meta.league_count).toBe(3)
  })

  it("activates an imported-league-only user identically to a native one", async () => {
    // The league list merges native League and imported LegacyLeague rows, so one
    // definition covers both. A definition that excluded imports would report the launch
    // as failing, since imports are the primary product motion.
    expect(await activate({ leagueCount: 1 })).toEqual({ status: "recorded" })
  })

  it("does NOT activate when league context could not be resolved", async () => {
    // null means the prefetch failed — "unknown", not "zero". Counting it would credit a
    // campaign for a dashboard that may have shown the user nothing at all.
    expect(await activate({ leagueCount: null })).toEqual({
      status: "skipped",
      reason: "context_unavailable",
    })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("does NOT activate on a successful load with zero leagues", async () => {
    // That screen is an onboarding prompt, not an activated experience.
    expect(await activate({ leagueCount: 0 })).toEqual({
      status: "skipped",
      reason: "no_usable_league_context",
    })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("is idempotent per user across repeat visits", async () => {
    mocks.findFirst.mockResolvedValue({ id: "existing" })

    expect(await activate({ leagueCount: 5 })).toEqual({ status: "skipped", reason: "already_activated" })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("does not double-count across /dashboard and /dashboard/v2", async () => {
    // Idempotency is scoped to userId alone — deliberately NOT to a surface or device — so
    // whichever dashboard loads first wins and the other finds the existing row.
    await activate({ leagueCount: 2 })
    expect(mocks.findFirst.mock.calls[0][0].where).toEqual({
      event: "acquisition.dashboard_activated",
      userId: "user-1",
    })
  })

  it("scopes the uniqueness check to the requesting user only", async () => {
    await activate({ userId: "user-A", leagueCount: 1 })
    await activate({ userId: "user-B", leagueCount: 1 })

    expect(mocks.findFirst.mock.calls[0][0].where.userId).toBe("user-A")
    expect(mocks.findFirst.mock.calls[1][0].where.userId).toBe("user-B")
    expect(mocks.create.mock.calls[0][0].data.userId).toBe("user-A")
    expect(mocks.create.mock.calls[1][0].data.userId).toBe("user-B")
  })

  it("attaches the linked campaign journey when attribution is present", async () => {
    const result = await activate({
      leagueCount: 1,
      jar: {
        [ANON_ID_COOKIE]: "anon-9",
        [FIRST_TOUCH_COOKIE]: touchFor("https://allfantasy.ai/?utm_source=tiktok&utm_campaign=launch_a"),
        [LATEST_TOUCH_COOKIE]: touchFor("https://allfantasy.ai/?utm_source=instagram&utm_campaign=ig_b"),
      },
    })

    expect(result).toEqual({ status: "recorded" })
    const { data } = mocks.create.mock.calls[0][0]
    expect(data.meta).toMatchObject({
      first_platform: "tiktok",
      first_campaign: "launch_a",
      latest_platform: "instagram",
      has_attribution: true,
    })
  })

  it("still activates with no attribution, and says so honestly", async () => {
    await activate({ leagueCount: 1 })

    const { data } = mocks.create.mock.calls[0][0]
    expect(data.meta.has_attribution).toBe(false)
    expect(data.meta).not.toHaveProperty("first_platform")
    expect(data.sessionId).toBeNull()
  })

  it("never throws when the write fails, so the dashboard still renders", async () => {
    mocks.create.mockRejectedValue(new Error("db down"))
    await expect(activate({ leagueCount: 1 })).resolves.toEqual({ status: "failed" })
  })

  it("never throws when the uniqueness lookup fails", async () => {
    mocks.findFirst.mockRejectedValue(new Error("db down"))
    await expect(activate({ leagueCount: 1 })).resolves.toEqual({ status: "failed" })
  })

  it("records at most one row when two loads race", async () => {
    // Simulates the second request observing the first one's row.
    let stored: { id: string } | null = null
    mocks.findFirst.mockImplementation(async () => stored)
    mocks.create.mockImplementation(async () => {
      stored = { id: "row-1" }
      return {}
    })

    const first = await activate({ leagueCount: 1 })
    const second = await activate({ leagueCount: 1 })

    expect(first).toEqual({ status: "recorded" })
    expect(second).toEqual({ status: "skipped", reason: "already_activated" })
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
})
