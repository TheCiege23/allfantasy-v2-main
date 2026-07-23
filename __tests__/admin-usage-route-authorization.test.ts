import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  prismaApiUsageEventCreate: vi.fn(),
  prismaApiUsageRollupFindUnique: vi.fn(),
  prismaApiUsageRollupUpsert: vi.fn(),
  prismaApiUsageRollupFindMany: vi.fn(),
  logApiFailure: vi.fn(),
  recordEngineTelemetrySample: vi.fn(),
  consumeRateLimit: vi.fn(),
  getClientIp: vi.fn(),
}))

vi.mock("@/lib/adminAuth", () => ({
  requireAdmin: mocks.requireAdmin,
}))

// withApiUsage (the route wrapper) unconditionally touches these on every
// request, including rejected 401/403 ones - mock them so tests never reach
// a real database. findMany is the routes' own read.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    apiUsageEvent: { create: mocks.prismaApiUsageEventCreate },
    apiUsageRollup: {
      findUnique: mocks.prismaApiUsageRollupFindUnique,
      upsert: mocks.prismaApiUsageRollupUpsert,
      findMany: mocks.prismaApiUsageRollupFindMany,
    },
  },
}))

vi.mock("@/lib/error-tracking", () => ({
  logApiFailure: mocks.logApiFailure,
}))

vi.mock("@/lib/analytics/recordAnalyticsEvent", () => ({
  recordEngineTelemetrySample: mocks.recordEngineTelemetrySample,
}))

vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  getClientIp: mocks.getClientIp,
}))

function getReq(url: string) {
  return new Request(url, { method: "GET" })
}

function postReq(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const UNAUTHORIZED = { ok: false as const, res: Response.json({ error: "Unauthorized" }, { status: 401 }) }
const FORBIDDEN = { ok: false as const, res: Response.json({ error: "Forbidden" }, { status: 403 }) }
const ADMIN_OK = { ok: true as const, user: { id: "admin-1", role: "admin" } }
// A league commissioner who is not a site admin resolves to the same forbidden
// gate result - the model-admin page reaches these routes from a league URL, so
// "commissioner of this league" must not be enough to read platform telemetry.
const COMMISSIONER_NOT_ADMIN = FORBIDDEN

// Deliberately shaped so ranking by volume and ranking by errors disagree:
// /api/ai/chat is the busiest and never fails, /api/rare is nearly idle and
// fails every call. A summary that sorts an already-truncated top-by-volume
// list can never surface /api/rare.
const ROLLUP_ROWS = [
  { endpoint: "/api/ai/chat", tool: "Chimmy", leagueId: "lg-1", count: 10, okCount: 10, errCount: 0, avgMs: 100, p95Ms: 200, maxMs: 300 },
  { endpoint: "/api/rare", tool: "Rare", leagueId: "lg-1", count: 1, okCount: 0, errCount: 1, avgMs: 50, p95Ms: 60, maxMs: 70 },
]

describe("admin usage route authorization", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.prismaApiUsageRollupFindUnique.mockResolvedValue(null)
    mocks.prismaApiUsageRollupUpsert.mockResolvedValue({})
    mocks.prismaApiUsageEventCreate.mockResolvedValue({})
    mocks.prismaApiUsageRollupFindMany.mockResolvedValue(ROLLUP_ROWS)
    mocks.consumeRateLimit.mockReturnValue({ success: true, remaining: 119, retryAfterSec: 0, resetTimeMs: 0, key: "k" })
    mocks.getClientIp.mockReturnValue("1.2.3.4")
  })

  describe("GET /api/admin/usage", () => {
    const URL_ = "http://localhost/api/admin/usage?bucketType=day&days=30"

    it("returns 401 for unauthenticated callers and never reads rollups", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(UNAUTHORIZED)
      const { GET } = await import("@/app/api/admin/usage/route")

      const res = await GET(getReq(URL_), {})

      expect(res.status).toBe(401)
      expect(mocks.prismaApiUsageRollupFindMany).not.toHaveBeenCalled()
    })

    it("returns 403 for authenticated non-admin callers and never reads rollups", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(FORBIDDEN)
      const { GET } = await import("@/app/api/admin/usage/route")

      const res = await GET(getReq(URL_), {})

      expect(res.status).toBe(403)
      expect(mocks.prismaApiUsageRollupFindMany).not.toHaveBeenCalled()
    })

    it("returns 403 for a league commissioner who is not a site admin", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(COMMISSIONER_NOT_ADMIN)
      const { GET } = await import("@/app/api/admin/usage/route")

      const res = await GET(getReq(URL_), {})

      expect(res.status).toBe(403)
      expect(mocks.prismaApiUsageRollupFindMany).not.toHaveBeenCalled()
    })

    it("returns rows for admins in the shape the panel reads", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(ADMIN_OK)
      const { GET } = await import("@/app/api/admin/usage/route")

      const res = await GET(getReq(URL_), {})
      const body = await res.json()

      expect(res.status).toBe(200)
      // UsageAnalyticsPanel reads `usageData.rows`.
      expect(body.rows).toEqual(ROLLUP_ROWS)
      expect(mocks.prismaApiUsageRollupFindMany).toHaveBeenCalledTimes(1)
    })

    // ApiUsageRollup.id / .bytesInSum / .bytesOutSum are BigInt columns and
    // JSON.stringify throws on BigInt, so a bare findMany() 500s on every call.
    // The panel's RollupRow needs none of them.
    it("never selects the BigInt columns, which would break JSON serialization", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(ADMIN_OK)
      const { GET } = await import("@/app/api/admin/usage/route")

      await GET(getReq(URL_), {})

      const select = mocks.prismaApiUsageRollupFindMany.mock.calls[0][0].select
      expect(select, "the query must use an explicit select").toBeTruthy()
      for (const bigintColumn of ["id", "bytesInSum", "bytesOutSum"]) {
        expect(select[bigintColumn], `${bigintColumn} must not be selected`).toBeUndefined()
      }
    })

    it("returns a response that actually serializes", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(ADMIN_OK)
      // Prisma hands back BigInt for BigInt columns; if the route ever selects
      // one, this call throws rather than silently passing on numeric fixtures.
      mocks.prismaApiUsageRollupFindMany.mockResolvedValueOnce([
        { ...ROLLUP_ROWS[0], bucketStart: new Date("2026-07-20T00:00:00Z"), bucketType: "day" },
      ])
      const { GET } = await import("@/app/api/admin/usage/route")

      const res = await GET(getReq(URL_), {})

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toBeTruthy()
    })

    // The row cap must keep the NEWEST buckets. Querying ascending with a take
    // returns the oldest, and the panel renders rows.slice(-80) - so an over-cap
    // range would show stale buckets while looking perfectly current.
    it("caps to the newest buckets and returns them chronologically", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(ADMIN_OK)
      mocks.prismaApiUsageRollupFindMany.mockResolvedValueOnce([
        { ...ROLLUP_ROWS[0], bucketStart: "2026-07-21" },
        { ...ROLLUP_ROWS[0], bucketStart: "2026-07-20" },
      ])
      const { GET } = await import("@/app/api/admin/usage/route")

      const res = await GET(getReq(URL_), {})
      const body = await res.json()

      expect(mocks.prismaApiUsageRollupFindMany.mock.calls[0][0].orderBy).toEqual([
        { bucketStart: "desc" },
      ])
      expect(mocks.prismaApiUsageRollupFindMany.mock.calls[0][0].take).toBe(5000)
      // Reversed back into chronological order for the panel.
      expect(body.rows.map((r: any) => r.bucketStart)).toEqual(["2026-07-20", "2026-07-21"])
    })

    it("clamps days and rejects an unknown bucketType rather than passing it to the query", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(ADMIN_OK)
      const { GET } = await import("@/app/api/admin/usage/route")

      const res = await GET(getReq("http://localhost/api/admin/usage?bucketType=DROP&days=99999"), {})
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.bucketType).toBe("day")
      expect(body.days).toBe(365)
      expect(mocks.prismaApiUsageRollupFindMany.mock.calls[0][0].where.bucketType).toBe("day")
    })
  })

  describe("GET /api/admin/usage/summary", () => {
    const URL_ = "http://localhost/api/admin/usage/summary?bucketType=day&days=30&topN=8"

    it("returns 401 for unauthenticated callers and never reads rollups", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(UNAUTHORIZED)
      const { GET } = await import("@/app/api/admin/usage/summary/route")

      const res = await GET(getReq(URL_), {})

      expect(res.status).toBe(401)
      expect(mocks.prismaApiUsageRollupFindMany).not.toHaveBeenCalled()
    })

    it("returns 403 for authenticated non-admin callers and never reads rollups", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(FORBIDDEN)
      const { GET } = await import("@/app/api/admin/usage/summary/route")

      const res = await GET(getReq(URL_), {})

      expect(res.status).toBe(403)
      expect(mocks.prismaApiUsageRollupFindMany).not.toHaveBeenCalled()
    })

    it("returns 403 for a league commissioner who is not a site admin", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(COMMISSIONER_NOT_ADMIN)
      const { GET } = await import("@/app/api/admin/usage/summary/route")

      const res = await GET(getReq(URL_), {})

      expect(res.status).toBe(403)
      expect(mocks.prismaApiUsageRollupFindMany).not.toHaveBeenCalled()
    })

    it("returns every field UsageAnalyticsPanel's Summary type declares", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(ADMIN_OK)
      const { GET } = await import("@/app/api/admin/usage/summary/route")

      const res = await GET(getReq(URL_), {})
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.totals).toEqual({ count: 11, ok: 10, err: 1, errRate: 9.1, avgMs: 75 })
      for (const key of ["topEndpoints", "topTools", "topLeagues", "topErrorEndpoints"]) {
        expect(Array.isArray(body[key]), `${key} must be an array`).toBe(true)
      }
      // TopRow = { name, count, err, p95 }
      expect(Object.keys(body.topEndpoints[0]).sort()).toEqual(["count", "err", "name", "p95"])
    })

    it("does not leak the internal avg accumulators into totals", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(ADMIN_OK)
      const { GET } = await import("@/app/api/admin/usage/summary/route")

      const res = await GET(getReq(URL_), {})
      const body = await res.json()

      expect(body.totals).not.toHaveProperty("avgMsSum")
      expect(body.totals).not.toHaveProperty("avgMsN")
    })

    it("ranks topErrorEndpoints across all endpoints, not just the top-N by volume", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(ADMIN_OK)
      const { GET } = await import("@/app/api/admin/usage/summary/route")

      // topN=1: the only endpoint by volume is /api/ai/chat, which has zero
      // errors. The single failing endpoint is the low-volume /api/rare, which
      // a sort over the already-truncated volume list could never reach.
      const res = await GET(getReq("http://localhost/api/admin/usage/summary?topN=1"), {})
      const body = await res.json()

      expect(body.topEndpoints.map((r: any) => r.name)).toEqual(["/api/ai/chat"])
      expect(body.topErrorEndpoints).toHaveLength(1)
      expect(body.topErrorEndpoints[0].name).toBe("/api/rare")
      expect(body.topErrorEndpoints[0].err).toBe(1)
    })
  })

  describe("POST /api/admin/usage/log", () => {
    const URL_ = "http://localhost/api/admin/usage/log"

    it("is NOT admin gated - its callers are ordinary end users", async () => {
      // useAnalytics.trackToolUse and logLegacyToolUsage fire from normal user
      // sessions; an admin gate here would silently drop all real telemetry.
      const { POST } = await import("@/app/api/admin/usage/log/route")

      const res = await POST(postReq(URL_, { tool: "StartSit", meta: { action: "run" } }), {})

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
      expect(mocks.requireAdmin).not.toHaveBeenCalled()
    })

    it("rate limits per IP rather than into one global anonymous bucket", async () => {
      const { POST } = await import("@/app/api/admin/usage/log/route")

      await POST(postReq(URL_, { tool: "StartSit" }), {})

      // Without includeIpInKey the key degenerates to a single platform-wide
      // bucket for every anonymous caller.
      expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
        expect.objectContaining({ includeIpInKey: true, ip: "1.2.3.4" })
      )
    })

    it("returns 429 with Retry-After once the limit is exhausted and writes nothing", async () => {
      mocks.consumeRateLimit.mockReturnValueOnce({
        success: false, remaining: 0, retryAfterSec: 42, resetTimeMs: 0, key: "k",
      })
      const { POST } = await import("@/app/api/admin/usage/log/route")

      const res = await POST(postReq(URL_, { tool: "StartSit" }), {})

      expect(res.status).toBe(429)
      expect(res.headers.get("Retry-After")).toBe("42")
      // The wrapper still records the request itself; the rejected body must not
      // produce a legacy_tool event of its own.
      const legacyWrites = mocks.prismaApiUsageEventCreate.mock.calls
        .filter((c) => c[0]?.data?.scope === "legacy_tool")
      expect(legacyWrites).toHaveLength(0)
    })

    it("survives a malformed body instead of 500ing", async () => {
      const { POST } = await import("@/app/api/admin/usage/log/route")

      const req = new Request(URL_, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ not valid json",
      })
      const res = await POST(req, {})

      expect(res.status).toBe(200)
    })
  })
})

// ── Regression guard: these routes must actually ship ────────────────────────

describe("admin usage routes survive the production build", () => {
  const root = resolve(__dirname, "..")
  const ROUTES = [
    "app/api/admin/usage/route.ts",
    "app/api/admin/usage/summary/route.ts",
    "app/api/admin/usage/log/route.ts",
  ]

  it("all three route files exist on disk", () => {
    expect(ROUTES.filter((r) => !existsSync(join(root, r)))).toEqual([])
  })

  // `app/api/admin` is excluded from the production build wholesale, so a route
  // that is not in the keep-list is deployed as a 404 - which is exactly how
  // UsageAnalyticsPanel came to render its error state for every admin. The
  // keep-list is maintained in three hand-copied places and nothing else
  // asserts they agree, so assert it here for these three routes.
  const KEEP_LISTS = [
    "scripts/vercel-next-build.cjs",
    "scripts/route-budget-count.mjs",
    "__tests__/route-budget.test.ts",
  ]

  for (const list of KEEP_LISTS) {
    it(`${list} keeps all three usage routes built`, () => {
      const src = readFileSync(join(root, list), "utf8")
      const missing = ROUTES.filter((route) => {
        // vercel-next-build.cjs writes paths as path.join('app', 'api', ...) segments
        // rather than as a plain slash-separated string.
        const asJoin = route.split("/").map((s) => `'${s}'`).join(", ")
        return !src.includes(route) && !src.includes(asJoin)
      })
      expect(missing, `${list} is missing keep entries for: ${missing.join(", ")}`).toEqual([])
    })
  }
})
