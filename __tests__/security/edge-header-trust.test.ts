// @vitest-environment node
/**
 * Forged edge-location headers must not reach anything on a Railway origin that no
 * Cloudflare of ours vouched for. All addresses are RFC 5737 documentation addresses.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn(async () => null) }))
vi.mock("@/lib/geo/geoIpFetch", () => ({ fetchIpApi: vi.fn(async () => null), fetchProxycheck: vi.fn(async () => null) }))
vi.mock("@/lib/geo/privateRelayEdge", () => ({ getRelayRangeSetEdge: vi.fn(async () => null) }))
vi.mock("@/lib/geo/privateRelayStore", () => ({ getRelayRangeSetNode: vi.fn(async () => null) }))

import { untrustedEdgeHeaderNames } from "@/lib/http/edgeHeaderTrust"
import { ORIGIN_AUTH_HEADER } from "@/lib/http/originLock"

const FORGED = {
  "cf-ipcountry": "US",
  "cf-region-code": "NY",
  "cf-connecting-ip": "198.51.100.99",
  "x-vercel-ip-country": "US",
  "x-real-ip": "192.0.2.10",
}

const WORKER_ENV = { RAILWAY_ENVIRONMENT_NAME: "production", RAILWAY_SERVICE_NAME: "allfantasy-v2-worker" }
const MAIN_ENV = { ...WORKER_ENV, RAILWAY_SERVICE_NAME: "allfantasy-v2-main", CF_ORIGIN_AUTH_SECRET: "edge-proof-test-value" }

describe("untrustedEdgeHeaderNames", () => {
  it("on a Railway service with no Cloudflare proof configured, removes every cf-* and x-vercel-* header", () => {
    const names = untrustedEdgeHeaderNames(new Headers(FORGED), WORKER_ENV).sort()
    expect(names).toEqual(["cf-connecting-ip", "cf-ipcountry", "cf-region-code", "x-vercel-ip-country"])
  })

  it("keeps cf-* when the request carries a valid Cloudflare proof, but never x-vercel-*", () => {
    const headers = new Headers({ ...FORGED, [ORIGIN_AUTH_HEADER]: "edge-proof-test-value" })
    expect(untrustedEdgeHeaderNames(headers, MAIN_ENV)).toEqual(["x-vercel-ip-country"])
  })

  it("removes cf-* when the proof is WRONG", () => {
    const headers = new Headers({ ...FORGED, [ORIGIN_AUTH_HEADER]: "edge-proof-test-valuX" })
    expect(untrustedEdgeHeaderNames(headers, MAIN_ENV)).toContain("cf-ipcountry")
  })

  it("changes nothing off Railway (local dev, Vercel previews)", () => {
    expect(untrustedEdgeHeaderNames(new Headers(FORGED), {})).toEqual([])
  })

  it("has an explicit emergency switch that trusts unverified cf-*", () => {
    const names = untrustedEdgeHeaderNames(new Headers(FORGED), { ...WORKER_ENV, AF_TRUST_UNVERIFIED_CF_HEADERS: "1" })
    expect(names).toEqual(["x-vercel-ip-country"])
  })
})

describe("middleware forwards only trusted edge headers to route handlers", () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
    vi.resetModules()
  })

  it("on the worker, a forged cf-ipcountry never reaches the route", async () => {
    Object.assign(process.env, WORKER_ENV)
    delete process.env.CF_ORIGIN_AUTH_SECRET
    delete process.env.CF_ORIGIN_LOCK_MODE
    const { middleware } = await import("@/middleware")
    const res = await middleware(
      new NextRequest("https://allfantasy-v2-worker-production.up.railway.app/api/af-debug/sha", { headers: FORGED }),
    )
    const overridden = (res.headers.get("x-middleware-override-headers") ?? "").split(",").map((s) => s.trim())
    // Next replaces the route's request headers with exactly this list, so absence = removed.
    expect(overridden.length).toBeGreaterThan(0)
    expect(overridden).not.toContain("cf-ipcountry")
    expect(overridden).not.toContain("cf-connecting-ip")
    expect(overridden).not.toContain("x-vercel-ip-country")
    expect(overridden).toContain("x-real-ip")
    expect(res.headers.get("x-middleware-request-cf-ipcountry")).toBeNull()
  })
})
