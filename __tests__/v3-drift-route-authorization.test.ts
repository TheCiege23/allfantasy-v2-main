import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getDriftSeries: vi.fn(),
  recordDriftMetrics: vi.fn(),
  prismaApiUsageEventCreate: vi.fn(),
  prismaApiUsageRollupFindUnique: vi.fn(),
  prismaApiUsageRollupUpsert: vi.fn(),
  logApiFailure: vi.fn(),
  recordEngineTelemetrySample: vi.fn(),
}))

vi.mock("@/lib/adminAuth", () => ({
  requireAdmin: mocks.requireAdmin,
}))

vi.mock("@/lib/rankings-engine/drift-metrics", () => ({
  getDriftSeries: mocks.getDriftSeries,
  recordDriftMetrics: mocks.recordDriftMetrics,
}))

// withApiUsage (the route wrapper) unconditionally touches these on every
// request, including rejected 401/403 ones - mock them so tests never reach
// a real database.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    apiUsageEvent: { create: mocks.prismaApiUsageEventCreate },
    apiUsageRollup: {
      findUnique: mocks.prismaApiUsageRollupFindUnique,
      upsert: mocks.prismaApiUsageRollupUpsert,
    },
  },
}))

vi.mock("@/lib/error-tracking", () => ({
  logApiFailure: mocks.logApiFailure,
}))

vi.mock("@/lib/analytics/recordAnalyticsEvent", () => ({
  recordEngineTelemetrySample: mocks.recordEngineTelemetrySample,
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

function malformedPostReq(url: string) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{ this is not valid json",
  })
}

/**
 * A POST request whose `json()` is spied on, so a test can prove the body was
 * never parsed. `req.json().catch(() => ({}))` would swallow a malformed body
 * and still surface the auth failure, so a malformed-body test alone cannot
 * detect the gate being moved after parsing - this can.
 */
function spiedPostReq(url: string, body: unknown) {
  const req = new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const jsonSpy = vi.fn(async () => body)
  Object.defineProperty(req, "json", { value: jsonSpy })
  return { req, jsonSpy }
}

const UNAUTHORIZED = { ok: false as const, res: Response.json({ error: "Unauthorized" }, { status: 401 }) }
const FORBIDDEN = { ok: false as const, res: Response.json({ error: "Forbidden" }, { status: 403 }) }
const ADMIN_OK = { ok: true as const, user: { id: "admin-1", role: "admin" } }
// A league commissioner who is not a site admin resolves to the same forbidden
// gate result - see model-admin-authorization-policy.test.ts, which proves that
// against the real lib/adminAuth rather than this mock.
const COMMISSIONER_NOT_ADMIN = FORBIDDEN

describe("v3 drift route authorization", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.prismaApiUsageRollupFindUnique.mockResolvedValue(null)
    mocks.prismaApiUsageRollupUpsert.mockResolvedValue({})
    mocks.prismaApiUsageEventCreate.mockResolvedValue({})
    mocks.getDriftSeries.mockResolvedValue([])
    mocks.recordDriftMetrics.mockResolvedValue({ id: "drift-1" })
  })

  describe("GET", () => {
    it("returns 401 for unauthenticated callers and never reads drift series", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(UNAUTHORIZED)
      const { GET } = await import("@/app/api/leagues/[leagueId]/v3/drift/route")

      const res = await GET(getReq("http://localhost/api/leagues/league-1/v3/drift"), {
        params: { leagueId: "league-1" },
      })

      expect(res.status).toBe(401)
      expect(mocks.getDriftSeries).not.toHaveBeenCalled()
    })

    it("returns 403 for authenticated non-admin callers and never reads drift series", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(FORBIDDEN)
      const { GET } = await import("@/app/api/leagues/[leagueId]/v3/drift/route")

      const res = await GET(getReq("http://localhost/api/leagues/league-1/v3/drift"), {
        params: { leagueId: "league-1" },
      })

      expect(res.status).toBe(403)
      expect(mocks.getDriftSeries).not.toHaveBeenCalled()
    })

    it("returns 403 for a league commissioner who is not a site admin", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(COMMISSIONER_NOT_ADMIN)
      const { GET } = await import("@/app/api/leagues/[leagueId]/v3/drift/route")

      const res = await GET(getReq("http://localhost/api/leagues/league-1/v3/drift"), {
        params: { leagueId: "league-1" },
      })

      expect(res.status).toBe(403)
      expect(mocks.getDriftSeries).not.toHaveBeenCalled()
    })

    it("returns drift series for admins", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(ADMIN_OK)
      mocks.getDriftSeries.mockResolvedValueOnce([{ id: "drift-1", day: "2026-07-01" }])
      const { GET } = await import("@/app/api/leagues/[leagueId]/v3/drift/route")

      const res = await GET(getReq("http://localhost/api/leagues/league-1/v3/drift?days=30"), {
        params: { leagueId: "league-1" },
      })
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(mocks.getDriftSeries).toHaveBeenCalledWith({ leagueId: "league-1", days: 30 })
      expect(body.rows).toEqual([{ id: "drift-1", day: "2026-07-01" }])
    })
  })

  describe("POST", () => {
    const validBody = { mode: "INSTANT", segmentKey: "global", nOffers: 10 }

    it("returns 401 for unauthenticated callers and never records metrics", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(UNAUTHORIZED)
      const { POST } = await import("@/app/api/leagues/[leagueId]/v3/drift/route")

      const res = await POST(postReq("http://localhost/api/leagues/league-1/v3/drift", validBody), {
        params: { leagueId: "league-1" },
      })

      expect(res.status).toBe(401)
      expect(mocks.recordDriftMetrics).not.toHaveBeenCalled()
    })

    it("returns 403 for authenticated non-admin callers and never records metrics", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(FORBIDDEN)
      const { POST } = await import("@/app/api/leagues/[leagueId]/v3/drift/route")

      const res = await POST(postReq("http://localhost/api/leagues/league-1/v3/drift", validBody), {
        params: { leagueId: "league-1" },
      })

      expect(res.status).toBe(403)
      expect(mocks.recordDriftMetrics).not.toHaveBeenCalled()
    })

    it("returns 403 for a league commissioner who is not a site admin", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(COMMISSIONER_NOT_ADMIN)
      const { POST } = await import("@/app/api/leagues/[leagueId]/v3/drift/route")

      const res = await POST(postReq("http://localhost/api/leagues/league-1/v3/drift", validBody), {
        params: { leagueId: "league-1" },
      })

      expect(res.status).toBe(403)
      expect(mocks.recordDriftMetrics).not.toHaveBeenCalled()
    })

    it("returns 401 for a malformed body from an unauthenticated caller", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(UNAUTHORIZED)
      const { POST } = await import("@/app/api/leagues/[leagueId]/v3/drift/route")

      const res = await POST(malformedPostReq("http://localhost/api/leagues/league-1/v3/drift"), {
        params: { leagueId: "league-1" },
      })

      // Authorization runs before body parsing, so a bad body cannot turn the
      // auth failure into a 400/500 or otherwise bypass the gate.
      expect(res.status).toBe(401)
      expect(mocks.recordDriftMetrics).not.toHaveBeenCalled()
    })

    it("returns 403 for a malformed body from a non-admin caller", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(FORBIDDEN)
      const { POST } = await import("@/app/api/leagues/[leagueId]/v3/drift/route")

      const res = await POST(malformedPostReq("http://localhost/api/leagues/league-1/v3/drift"), {
        params: { leagueId: "league-1" },
      })

      expect(res.status).toBe(403)
      expect(mocks.recordDriftMetrics).not.toHaveBeenCalled()
    })

    it("never parses the request body when authorization fails", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(UNAUTHORIZED)
      const { POST } = await import("@/app/api/leagues/[leagueId]/v3/drift/route")
      const { req, jsonSpy } = spiedPostReq("http://localhost/api/leagues/league-1/v3/drift", validBody)

      const res = await POST(req, { params: { leagueId: "league-1" } })

      expect(res.status).toBe(401)
      expect(jsonSpy).not.toHaveBeenCalled()
      expect(mocks.recordDriftMetrics).not.toHaveBeenCalled()
    })

    it("records drift metrics for admins", async () => {
      mocks.requireAdmin.mockResolvedValueOnce(ADMIN_OK)
      const { POST } = await import("@/app/api/leagues/[leagueId]/v3/drift/route")

      const res = await POST(postReq("http://localhost/api/leagues/league-1/v3/drift", validBody), {
        params: { leagueId: "league-1" },
      })
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body).toEqual({ ok: true, row: { id: "drift-1" } })
      expect(mocks.recordDriftMetrics).toHaveBeenCalledWith(
        expect.objectContaining({ leagueId: "league-1", mode: "INSTANT", segmentKey: "global", nOffers: 10 }),
      )
    })
  })
})
