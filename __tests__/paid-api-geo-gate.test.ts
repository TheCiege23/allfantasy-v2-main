// @vitest-environment node
/**
 * Paid API routes must refuse restricted states, the way paid pages already do.
 *
 * Why this file exists. middleware.ts lists paid API surfaces in
 * PAID_GEO_PREFIXES / PAID_GEO_PATTERNS, and its geo block has an explicit
 * `pathname.startsWith("/api/")` branch that answers 451 PAID_GEO_BLOCKED. That
 * branch could never run: `routeMiddleware` returns early for every `/api/*`
 * path, many lines above it. Checkout and the billing portal were covered only
 * because their route handlers call `enforcePaidSubscriptionGeo` themselves.
 * `/api/user/autocoach`, `/api/leagues/import`, dispersal-draft, integrity and
 * autocoach-settings relied on the middleware alone, so they were open to
 * HI, ID, MT and NV — and to WA, whose full block did not reach them either.
 *
 * ⚠ The assertions drive the REAL `middleware()` with the headers Cloudflare
 * sends, because the defect was never in the list or the helper — both were
 * right. It was in whether the code that used them was reachable.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }))
vi.mock("@/lib/geo/geoIpFetch", () => ({ fetchIpApi: vi.fn(async () => null), fetchProxycheck: vi.fn(async () => null) }))

import { getToken } from "next-auth/jwt"
import { middleware } from "@/middleware"

const mockedGetToken = vi.mocked(getToken)

/** The owner account hardcoded in MIDDLEWARE_ADMIN_USER_IDS. */
const OWNER_ID = "3a7ffd10-b1a5-4a40-8d07-232364596735"

function fromState(path: string, region: string | null, country = "US", method = "POST") {
  const headers: Record<string, string> = { "cf-ipcountry": country, "cf-connecting-ip": "198.51.100.40" }
  if (region) headers["cf-region-code"] = region
  return new NextRequest(new URL(`https://www.allfantasy.ai${path}`), { method, headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXTAUTH_SECRET = "test-nextauth-secret-not-a-real-credential"
  mockedGetToken.mockResolvedValue(null)
})

const PAID_API_ROUTES = [
  "/api/user/autocoach",
  "/api/leagues/import",
  "/api/leagues/import/sleeper",
  "/api/leagues/abc123/dispersal-draft",
  "/api/leagues/abc123/integrity",
  "/api/leagues/abc123/autocoach-settings",
]

describe("paid API routes refuse paid-block states", () => {
  for (const path of PAID_API_ROUTES) {
    it(`451 PAID_GEO_BLOCKED for Nevada on ${path}`, async () => {
      const res = await middleware(fromState(path, "NV"))
      expect(res.status).toBe(451)
      const body = await res.json()
      expect(body.error).toBe("PAID_GEO_BLOCKED")
      expect(body.redirectTo).toBe("/paid-restricted")
    })
  }

  it("answers JSON, never an HTML redirect, on an API path", async () => {
    const res = await middleware(fromState("/api/user/autocoach", "HI"))
    expect(res.headers.get("content-type")).toMatch(/application\/json/)
    expect(res.headers.get("location")).toBeNull()
  })
})

describe("Washington — a full block includes the paid tier", () => {
  it("403 GEO_BLOCKED on a paid API route", async () => {
    const res = await middleware(fromState("/api/leagues/import", "WA"))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe("GEO_BLOCKED")
  })
})

describe("what must stay open", () => {
  it("a NON-paid API route from Nevada (free play is legal there)", async () => {
    const res = await middleware(fromState("/api/leagues", "NV", "US", "GET"))
    expect([451, 403]).not.toContain(res.status)
  })

  it("a paid API route from an unrestricted state", async () => {
    const res = await middleware(fromState("/api/leagues/import", "NJ"))
    expect([451, 403]).not.toContain(res.status)
  })

  it("a paid API route from outside the US", async () => {
    const res = await middleware(fromState("/api/leagues/import", "BC", "CA"))
    expect([451, 403]).not.toContain(res.status)
  })

  it("a paid API route when no edge placed the request and the IP fallback has nothing", async () => {
    const res = await middleware(fromState("/api/leagues/import", null, ""))
    expect([451, 403]).not.toContain(res.status)
  })

  it("the app owner, who bypasses geo on pages and must here too", async () => {
    mockedGetToken.mockResolvedValue({ sub: OWNER_ID } as never)
    const res = await middleware(fromState("/api/leagues/import", "NV"))
    expect([451, 403]).not.toContain(res.status)
  })

  it("a cron from a Washington address (GitHub Actions runs in Azure West US 2)", async () => {
    const res = await middleware(fromState("/api/cron/import-players", "WA", "US", "GET"))
    expect([451, 403]).not.toContain(res.status)
  })
})

describe("cost: a non-paid API request does no session work", () => {
  it("never decodes a session token for a route that is not paid", async () => {
    await middleware(fromState("/api/leagues", "NV", "US", "GET"))
    expect(mockedGetToken).not.toHaveBeenCalled()
  })
})

describe("pages keep the behaviour they already had", () => {
  // Not /dashboard/rankings: /dashboard now forwards to /core before the geo
  // block runs, so that PAID_GEO_PATTERNS entry no longer guards anything.
  it("still redirects Nevada away from a paid page", async () => {
    mockedGetToken.mockResolvedValue({ sub: "a-signed-in-user", username: "someone" } as never)
    const res = await middleware(fromState("/league/abc123/dispersal-draft", "NV", "US", "GET"))
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    expect(res.headers.get("location")).toMatch(/\/paid-restricted\?state=NV/)
  })
})
