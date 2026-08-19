// @vitest-environment node
/**
 * app/api/shared/activity/route.ts — the server-side self-defense added after a pre-deploy client
 * bundle polled this endpoint at ~6 req/s for 29+ hours and exhausted production Postgres. These
 * tests exercise the REAL rate limiter (@/lib/rate-limit) and REAL cache; only the session and the
 * DB-backed sources are mocked. They prove:
 *   - honest-empty is preserved (no session, and the error fallback);
 *   - an identical repeat poll is coalesced from cache without re-touching the DB;
 *   - the rate limit is shared across a session's per-league params (the card fan-out), so a
 *     second distinct-param miss is 429'd with a Retry-After — this is the actual protection;
 *   - the budget is per-user (one session's fan-out can't throttle another user);
 *   - the error fallback is never cached.
 *
 * The rate-limit map is process-global and not resettable, so each test uses a unique userId.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { getServerSessionMock, getLeagueListMock, nativeSourceMock, injurySourceMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  getLeagueListMock: vi.fn(),
  nativeSourceMock: vi.fn(),
  injurySourceMock: vi.fn(),
}))

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/dashboard/get-dashboard-league-list", () => ({
  getDashboardLeagueListForUser: getLeagueListMock,
}))
vi.mock("@/lib/activity/sources/nativeLeagueActivity", () => ({
  collectNativeLeagueActivity: nativeSourceMock,
}))
vi.mock("@/lib/activity/sources/rosterInjuryActivity", () => ({
  collectRosterInjuryActivity: injurySourceMock,
}))
// collectSleeperActivity lives in the route itself; stub the Sleeper client so it stays inert.
vi.mock("@/lib/sleeper-client", () => ({
  getAllPlayers: vi.fn(async () => ({})),
  getLeagueRosters: vi.fn(async () => []),
  getLeagueTransactions: vi.fn(async () => []),
  getLeagueUsers: vi.fn(async () => []),
  getNflState: vi.fn(async () => ({ week: 1 })),
  getPlayerName: vi.fn(() => "Player"),
}))

import { GET } from "@/app/api/shared/activity/route"
import { clearActivityFeedCache, getActivityFeedCacheSize } from "@/lib/activity/activity-response-cache"

const nativeItem = {
  id: "native:1",
  type: "announcement" as const,
  userId: "",
  userName: "Commish",
  description: "Welcome to the league",
  timestamp: "2026-07-17T00:00:00.000Z",
  leagueId: "L1",
  leagueName: "L1",
  source: "native" as const,
}

function req(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString()
  return new NextRequest(`http://localhost/api/shared/activity?${qs}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  clearActivityFeedCache()
  getLeagueListMock.mockResolvedValue({ leagues: [] }) // no Sleeper leagues → Sleeper source is inert
  nativeSourceMock.mockResolvedValue([nativeItem])
  injurySourceMock.mockResolvedValue([])
})

afterEach(() => clearActivityFeedCache())

describe("GET /api/shared/activity — honest-empty", () => {
  it("returns an honest-empty feed with no session and never resolves leagues", async () => {
    getServerSessionMock.mockResolvedValue(null)
    const res = await GET(req({ limit: "20" }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: "ok", items: [] })
    expect(getLeagueListMock).not.toHaveBeenCalled()
  })
})

describe("GET /api/shared/activity — cache coalescing", () => {
  it("computes on the first poll (X-Cache MISS) and serves the identical repeat from cache without re-touching the DB", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u-coalesce" } })

    const first = await GET(req({ limit: "20", leagueId: "L1" }))
    expect(first.status).toBe(200)
    expect(first.headers.get("X-Cache")).toBe("MISS")
    expect((await first.json()).items).toHaveLength(1)
    expect(getLeagueListMock).toHaveBeenCalledTimes(1)

    const second = await GET(req({ limit: "20", leagueId: "L1" }))
    expect(second.status).toBe(200)
    expect(second.headers.get("X-Cache")).toBe("HIT")
    expect((await second.json()).items).toHaveLength(1)
    // The coalesced hit must not have re-run the aggregation — no second DB resolve.
    expect(getLeagueListMock).toHaveBeenCalledTimes(1)
  })
})

describe("GET /api/shared/activity — per-user rate limit shared across params (the fan-out cap)", () => {
  it("429s a second distinct-param miss from the same session, with a Retry-After, without touching the DB", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u-fanout" } })

    const a = await GET(req({ limit: "20", leagueId: "L1" }))
    expect(a.status).toBe(200)
    expect(a.headers.get("X-Cache")).toBe("MISS")

    // A different league card from the SAME session — a cache miss (different key), so it reaches
    // the rate limit. The budget is keyed on userId alone, so the fan-out shares one bucket.
    const b = await GET(req({ limit: "20", leagueId: "L2" }))
    expect(b.status).toBe(429)
    const retryAfter = Number(b.headers.get("Retry-After"))
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(10)
    const body = await b.json()
    expect(body.status).toBe("rate_limited")
    expect(body.items).toEqual([]) // honest-empty under back-pressure, never fabricated
    // The throttled request must never have opened a Postgres connection.
    expect(getLeagueListMock).toHaveBeenCalledTimes(1)
  })

  it("is per-user: one session's spent budget does not throttle a different user", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u-first" } })
    await GET(req({ limit: "20", leagueId: "L1" }))
    const throttled = await GET(req({ limit: "20", leagueId: "L2" }))
    expect(throttled.status).toBe(429)

    getServerSessionMock.mockResolvedValue({ user: { id: "u-second" } })
    const other = await GET(req({ limit: "20", leagueId: "L1" }))
    expect(other.status).toBe(200)
    expect(other.headers.get("X-Cache")).toBe("MISS")
  })
})

describe("GET /api/shared/activity — error fallback", () => {
  it("returns honest-empty when aggregation throws and never caches the failure", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u-error" } })
    getLeagueListMock.mockRejectedValueOnce(new Error("db down"))

    const res = await GET(req({ limit: "20", leagueId: "L1" }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: "ok", items: [] })
    // A cached empty here would pin the failure; the error path must leave the cache untouched.
    expect(getActivityFeedCacheSize()).toBe(0)
  })
})
