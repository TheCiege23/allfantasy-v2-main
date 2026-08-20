/**
 * Admin campaign attribution: authorization and data-truth semantics.
 *
 * The properties under test are the ones that decide whether an operator can trust the
 * page: that a non-admin gets nothing, that an unbuilt funnel stage never renders as 0,
 * and that a failed query never renders as 0 either.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  queryRaw: vi.fn(),
}))

vi.mock("@/lib/adminAuth", () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: mocks.queryRaw } }))

function req(qs = "") {
  return new Request(`https://allfantasy.ai/api/admin/visitor-analytics/campaigns${qs}`)
}

async function callRoute(request = req()) {
  const { GET } = await import("@/app/api/admin/visitor-analytics/campaigns/route")
  return GET(request)
}

async function report(filters = {}) {
  const { getCampaignAttributionReport } = await import("@/lib/admin-dashboard/CampaignAttributionService")
  return getCampaignAttributionReport(filters)
}

const CAMPAIGN_ROW = {
  platform: "tiktok",
  source: "tiktok",
  medium: "social",
  campaign: "launch_a",
  content: "slide-3",
  campaign_id: "camp_100",
  landing_path: "/",
  unique_visitors: 40n,
  events: 55n,
  landing_views: 40n,
  signups: 10n,
  activations: 4n,
  linked: 8n,
  first_activity: new Date("2026-07-20T00:00:00Z"),
  latest_activity: new Date("2026-07-23T00:00:00Z"),
}

const TOTALS_ROW = {
  unique_visitors: 40n,
  events: 55n,
  landing_views: 40n,
  signups: 10n,
  activations: 4n,
  linked: 8n,
  last_event: new Date("2026-07-23T00:00:00Z"),
}

describe("admin campaign attribution — authorization", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.queryRaw.mockResolvedValue([])
  })

  it("refuses an unauthenticated caller and runs no query", async () => {
    mocks.requireAdmin.mockResolvedValue({
      ok: false,
      res: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    })

    const res = await callRoute()

    expect(res.status).toBe(401)
    // The gate must run BEFORE any data access, not merely hide the result.
    expect(mocks.queryRaw).not.toHaveBeenCalled()
  })

  it("refuses an authenticated non-admin and runs no query", async () => {
    mocks.requireAdmin.mockResolvedValue({
      ok: false,
      res: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    })

    const res = await callRoute()

    expect(res.status).toBe(403)
    expect(mocks.queryRaw).not.toHaveBeenCalled()
  })

  it("serves the report to a verified admin", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: true, user: { id: "admin-1", role: "admin" } })
    mocks.queryRaw.mockResolvedValueOnce([CAMPAIGN_ROW]).mockResolvedValueOnce([TOTALS_ROW])

    const res = await callRoute()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.campaigns[0]).toMatchObject({ platform: "tiktok", campaign: "launch_a", signupsCompleted: 10 })
  })

  it("exposes no per-user records — only aggregates", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: true, user: { id: "admin-1" } })
    mocks.queryRaw.mockResolvedValueOnce([CAMPAIGN_ROW]).mockResolvedValueOnce([TOTALS_ROW])

    const body = await (await callRoute()).json()
    const serialized = JSON.stringify(body)

    // Assert on PII SHAPES, not substrings: the payload legitimately contains the funnel
    // stage name "email_verified", so a naive `not.toContain("email")` fails on correct
    // output and would train us to weaken the check.
    expect(serialized).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/) // no email address
    expect(serialized).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/) // no IPv4
    expect(serialized).not.toMatch(/"(password|passwordHash|token|accessToken|refreshToken|emailHash)"\s*:/)

    // And structurally: the report is aggregates only — no per-user identity anywhere.
    expect(body).not.toHaveProperty("users")
    for (const row of body.campaigns) {
      expect(row).not.toHaveProperty("userId")
      expect(row).not.toHaveProperty("sessionId")
    }
  })
})

describe("admin campaign attribution — data truth", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it("reports unbuilt stages as not_implemented with a NULL value, never 0", async () => {
    mocks.queryRaw.mockResolvedValueOnce([CAMPAIGN_ROW]).mockResolvedValueOnce([TOTALS_ROW])

    const result = await report()
    const unbuilt = result.summary.filter((m) => m.status === "not_implemented")

    expect(unbuilt.length).toBeGreaterThan(0)
    for (const metric of unbuilt) {
      // A 0 here would read as "we measured it and nothing happened".
      expect(metric.value).toBeNull()
      expect(metric.note).toBeTruthy()
    }
    expect(unbuilt.map((m) => m.key)).toEqual(
      expect.arrayContaining(["start_clicked", "onboarding_completed", "paid_conversion_confirmed"]),
    )
    // Phase 1B shipped these two, so they must NOT appear as unbuilt any more.
    expect(unbuilt.map((m) => m.key)).not.toContain("landing_viewed")
    expect(unbuilt.map((m) => m.key)).not.toContain("dashboard_activated")
  })

  it("never reports returning_authenticated as measured — the link event is not a proxy", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([TOTALS_ROW])

    const result = await report()
    const returning = result.summary.find((m) => m.key === "returning_authenticated")

    expect(returning?.status).toBe("not_implemented")
    expect(returning?.value).toBeNull()
  })

  it("distinguishes a failed query from a real zero", async () => {
    mocks.queryRaw.mockRejectedValue(new Error("connection reset"))

    const result = await report()
    const visitors = result.summary.find((m) => m.key === "unique_visitors")

    expect(visitors?.status).toBe("query_failed")
    expect(visitors?.value).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("distinguishes an empty window from a failure", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { unique_visitors: 0n, events: 0n, landing_views: 0n, signups: 0n, activations: 0n, linked: 0n, last_event: null },
      ])

    const result = await report()
    const visitors = result.summary.find((m) => m.key === "unique_visitors")

    expect(visitors?.status).toBe("no_activity")
    expect(visitors?.value).toBeNull()
    expect(result.freshness).toBe("no_data")
    expect(result.errors).toHaveLength(0)
  })

  it("returns null — not 0% — for a conversion rate with no denominator", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ ...CAMPAIGN_ROW, unique_visitors: 0n, signups: 0n }])
      .mockResolvedValueOnce([TOTALS_ROW])

    const result = await report()
    expect(result.campaigns[0].visitorToSignupRate).toBeNull()
  })

  it("computes a real conversion rate when the denominator is non-zero", async () => {
    mocks.queryRaw.mockResolvedValueOnce([CAMPAIGN_ROW]).mockResolvedValueOnce([TOTALS_ROW])

    const result = await report()
    expect(result.campaigns[0].visitorToSignupRate).toBeCloseTo(0.25, 4)
  })

  it("reports landing views and activations per campaign", async () => {
    mocks.queryRaw.mockResolvedValueOnce([CAMPAIGN_ROW]).mockResolvedValueOnce([TOTALS_ROW])

    const result = await report()
    expect(result.campaigns[0]).toMatchObject({ landingViews: 40, dashboardsActivated: 4 })
    expect(result.summary.find((m) => m.key === "landing_viewed")).toMatchObject({ value: 40, status: "confirmed" })
    expect(result.summary.find((m) => m.key === "dashboard_activated")).toMatchObject({ value: 4, status: "confirmed" })
  })

  it("computes the account-to-activation conversion campaigns are judged on", async () => {
    mocks.queryRaw.mockResolvedValueOnce([CAMPAIGN_ROW]).mockResolvedValueOnce([TOTALS_ROW])

    const result = await report()
    // 4 activations / 10 accounts, and 4 / 40 visitors.
    expect(result.campaigns[0].signupToActivationRate).toBeCloseTo(0.4, 4)
    expect(result.campaigns[0].visitorToActivationRate).toBeCloseTo(0.1, 4)
    expect(result.conversions.signupToActivation).toBeCloseTo(0.4, 4)
    expect(result.conversions.visitorToActivation).toBeCloseTo(0.1, 4)
  })

  it("returns null activation rates when nobody signed up, never 0%", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ ...CAMPAIGN_ROW, signups: 0n, activations: 0n }])
      .mockResolvedValueOnce([TOTALS_ROW])

    expect((await report()).campaigns[0].signupToActivationRate).toBeNull()
  })

  it("labels campaign grouping as first-touch so totals are never silently mixed", async () => {
    mocks.queryRaw.mockResolvedValueOnce([CAMPAIGN_ROW]).mockResolvedValueOnce([TOTALS_ROW])
    expect((await report()).attributionGrouping).toBe("first_touch")
  })

  it("clamps the window so an unbounded scan cannot be requested", async () => {
    mocks.queryRaw.mockResolvedValue([])

    expect((await report({ windowDays: 100000 })).window.days).toBe(365)
    expect((await report({ windowDays: -5 })).window.days).toBe(1)
    expect((await report({ windowDays: undefined })).window.days).toBe(30)
  })

  it("flags truncation instead of silently dropping campaigns", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ ...CAMPAIGN_ROW, campaign: `c${i}` }))
    mocks.queryRaw.mockResolvedValueOnce(rows).mockResolvedValueOnce([TOTALS_ROW])

    const result = await report({ limit: 5 })

    expect(result.campaigns).toHaveLength(5)
    expect(result.campaignsTruncated).toBe(true)
  })

  it("converts BigInt counts so the response can serialize", async () => {
    mocks.queryRaw.mockResolvedValueOnce([CAMPAIGN_ROW]).mockResolvedValueOnce([TOTALS_ROW])

    const result = await report()
    // Postgres COUNT() returns BigInt through Prisma; an unconverted value throws on
    // JSON.stringify and 500s the route in production while passing a naive unit test.
    expect(() => JSON.stringify(result)).not.toThrow()
    expect(typeof result.campaigns[0].uniqueVisitors).toBe("number")
    expect(typeof result.sampleSize).toBe("number")
  })

  it("carries definition, source, and sample size for every reported metric", async () => {
    mocks.queryRaw.mockResolvedValueOnce([CAMPAIGN_ROW]).mockResolvedValueOnce([TOTALS_ROW])

    const result = await report()
    expect(result.sampleSize).toBe(55)
    for (const metric of result.summary) {
      expect(metric.definition).toBeTruthy()
      expect(metric.source).toBeTruthy()
    }
  })
})
