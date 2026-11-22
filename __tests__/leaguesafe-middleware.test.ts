// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { createRequire } from "node:module"

const mocks = vi.hoisted(() => ({
  getToken: vi.fn(), fetchProxycheck: vi.fn(), fetchIpApi: vi.fn(),
  createMany: vi.fn(), findUniqueOrThrow: vi.fn(),
}))
vi.mock("next-auth/jwt", () => ({ getToken: mocks.getToken }))
vi.mock("@/lib/geo/geoIpFetch", () => ({
  fetchProxycheck: mocks.fetchProxycheck, fetchIpApi: mocks.fetchIpApi,
}))
vi.mock("@/lib/geo/privateRelayEdge", () => ({ getRelayRangeSetEdge: vi.fn(async () => null) }))
vi.mock("@/lib/geo/privateRelayStore", () => ({ getRelayRangeSetNode: vi.fn(async () => null) }))
vi.mock("@/lib/prisma", () => ({
  prisma: { leagueSafeRawEmail: { createMany: mocks.createMany, findUniqueOrThrow: mocks.findUniqueOrThrow } },
}))

import { middleware } from "@/middleware"
import { POST } from "@/app/api/integrations/leaguesafe/inbound/route"
import { __resetAnonymizerCache } from "@/lib/geo/anonymizerCache"
import { __resetProxycheckDeniedWarning } from "@/lib/geo/geoIpParse"

const PATH = "/api/integrations/leaguesafe/inbound"
const HOSTING_IP = "198.51.100.84"
const HOME_IP = "198.51.100.85"

function request(path = PATH, method = "POST", ip = HOSTING_IP, region = "OR", extra: Record<string, string> = {}) {
  return new NextRequest("https://www.allfantasy.ai" + path, {
    method,
    headers: {
      "cf-ipcountry": "US", "cf-region-code": region, "cf-connecting-ip": ip,
      "user-agent": "Mozilla/5.0 (compatible; Google-Apps-Script)",
      "content-type": "application/json", ...extra,
    },
    ...(method === "POST" ? { body: "{}" } : {}),
  })
}

// A real Request from Next's separate edge VM fails the Node Request identity check.
// Add the NextRequest URL/cookie views used by the middleware without changing its method.
const { EdgeRuntime } = createRequire(import.meta.url)("next/dist/compiled/edge-runtime") as {
  EdgeRuntime: new () => { context: { Request: typeof Request } }
}
const edgeRuntime = new EdgeRuntime()
function edgeRequest(...args: Parameters<typeof request>): NextRequest {
  const original = request(...args)
  const inbound = new edgeRuntime.context.Request(original.url, {
    method: original.method,
    headers: [...original.headers.entries()],
    ...(original.method === "POST" ? { body: "{}" } : {}),
  })
  Object.defineProperties(inbound, {
    nextUrl: { value: original.nextUrl },
    cookies: { value: original.cookies },
  })
  return inbound as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetAnonymizerCache()
  __resetProxycheckDeniedWarning()
  vi.stubEnv("NEXTAUTH_SECRET", "synthetic-nextauth-secret-for-middleware-test")
  vi.stubEnv("PROXYCHECK_API_KEY", "synthetic-proxycheck-key")
  vi.stubEnv("IPAPI_KEY", "")
  vi.stubEnv("CF_ORIGIN_AUTH_SECRET", "")
  vi.stubEnv("CF_ORIGIN_LOCK_MODE", "off")
  vi.stubEnv("LS_INBOUND_SECRET", "synthetic-leaguesafe-secret-with-at-least-32-bytes")
  vi.stubEnv("LS_SENDER_DOMAINS", "notices.example")
  mocks.getToken.mockResolvedValue(null)
  mocks.fetchIpApi.mockResolvedValue(null)
  mocks.fetchProxycheck.mockImplementation(async (ip: string) => ({
    status: "ok",
    [ip]: ip === HOSTING_IP
      ? { proxy: "no", type: "Hosting", asn: "AS15169", provider: "Google LLC" }
      : { proxy: "no", type: "Residential", asn: "AS7922", provider: "Comcast" },
  }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe("LeagueSafe machine ingestion through the real middleware", () => {
  it("preserves an edge-runtime POST through header sanitization", async () => {
    const inbound = edgeRequest()
    expect(inbound.method).toBe("POST")
    expect(inbound instanceof Request).toBe(false)
    const response = await middleware(inbound)
    expect(response.status).toBe(200)
    expect(response.headers.get("x-middleware-next")).toBe("1")
    expect(mocks.fetchProxycheck).not.toHaveBeenCalled()
  })
  it.each(["GET", "HEAD", "PUT", "DELETE"])("does not exempt an edge-runtime %s", async (method) => {
    const response = await middleware(edgeRequest(PATH, method))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: "VPN_BLOCKED" })
  })
  it("keeps adjacent edge-runtime POSTs gated", async () => {
    const response = await middleware(edgeRequest(PATH + "/other"))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: "VPN_BLOCKED" })
  })
  it("enforces the origin lock before allowing an edge-runtime POST", async () => {
    vi.stubEnv("CF_ORIGIN_AUTH_SECRET", "synthetic-origin-lock-secret")
    vi.stubEnv("CF_ORIGIN_LOCK_MODE", "enforce")
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const response = await middleware(edgeRequest())
    expect(response.status).toBe(403)
    expect(await response.text()).toBe("Forbidden")
    expect(mocks.fetchProxycheck).not.toHaveBeenCalled()
    expect(mocks.createMany).not.toHaveBeenCalled()
  })
  it("allows the exact inbound POST from a data center to reach its HMAC handler", async () => {
    const response = await middleware(request())
    expect(response.status).toBe(200)
    expect(response.headers.get("x-middleware-next")).toBe("1")
    expect(mocks.fetchProxycheck).not.toHaveBeenCalled()
  })
  it("allows the inbound POST from a Washington address too", async () => {
    const response = await middleware(request(PATH, "POST", HOME_IP, "WA"))
    expect(response.status).toBe(200)
    expect(response.headers.get("x-middleware-next")).toBe("1")
  })
  it.each(["GET", "HEAD", "PUT", "DELETE"])("does not exempt %s requests", async (method) => {
    const response = await middleware(request(PATH, method))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: "VPN_BLOCKED" })
  })
  it.each([
    PATH + "/other", PATH + "-other", "/api/integrations/leaguesafe",
    "/api/integrations/other/inbound", "/api/user/autocoach", "/api/auth/register",
  ])("keeps location/VPN protections on adjacent and human API paths: %s", async (path) => {
    const response = await middleware(request(path))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: "VPN_BLOCKED" })
  })
  it("preserves the origin lock on the capture route", async () => {
    vi.stubEnv("CF_ORIGIN_AUTH_SECRET", "synthetic-origin-lock-secret")
    vi.stubEnv("CF_ORIGIN_LOCK_MODE", "enforce")
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const response = await middleware(request())
    expect(response.status).toBe(403)
    expect(await response.text()).toBe("Forbidden")
    expect(mocks.createMany).not.toHaveBeenCalled()
  })
  it.each([
    { kind: "unsigned", runtime: "node" }, { kind: "forged", runtime: "node" },
    { kind: "unsigned", runtime: "edge" }, { kind: "forged", runtime: "edge" },
  ])("still refuses $kind ingestion from $runtime without database writes", async ({ kind, runtime }) => {
    const headers: Record<string, string> = kind === "forged" ? {
      "x-ls-timestamp": String(Math.floor(Date.now() / 1000)),
      "x-ls-signature": "v1=" + "0".repeat(64),
    } : {}
    const inbound = (runtime === "edge" ? edgeRequest : request)(PATH, "POST", HOSTING_IP, "OR", headers)
    expect((await middleware(inbound)).headers.get("x-middleware-next")).toBe("1")
    vi.spyOn(console, "warn").mockImplementation(() => {})
    // Next executes middleware and the Node handler in separate request contexts.
    const response = await POST(request(PATH, "POST", HOSTING_IP, "OR", headers))
    expect(response.status).toBe(401)
    expect(mocks.createMany).not.toHaveBeenCalled()
    expect(mocks.findUniqueOrThrow).not.toHaveBeenCalled()
  })
})