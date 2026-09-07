// @vitest-environment node
/**
 * Pins the cached IP lookup that lets the MIDDLEWARE gate enforce state
 * restrictions when no edge header placed the request.
 *
 * ⚠ THE CACHE IS THE FEATURE, NOT AN OPTIMISATION. `middleware.ts`'s matcher
 * covers everything but static assets, so an uncached lookup here would be one
 * vendor call per document, per chunk and per API hit — a rate limit reached by
 * the first visitor. Most of these tests are about CALL COUNT for that reason,
 * and a regression in any of them is an outbound flood rather than a wrong
 * answer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/geo/geoIpFetch", () => ({
  fetchIpApi: vi.fn(),
  fetchProxycheck: vi.fn(),
}))

import { fetchIpApi } from "@/lib/geo/geoIpFetch"
import {
  resolveGeoByIp,
  isPublicIp,
  geoIpCacheStats,
  __resetGeoIpCache,
} from "@/lib/geo/geoIpCache"
import { __resetIpApiShapeWarning } from "@/lib/geo/geoIpParse"
import { isFullyBlocked } from "@/lib/geo/restrictedStates"

const mockedIpApi = vi.mocked(fetchIpApi)

const PUBLIC_IP = "166.205.54.18"

beforeEach(() => {
  __resetGeoIpCache()
  __resetIpApiShapeWarning()
  vi.clearAllMocks()
  process.env.IPAPI_KEY = "test-key-not-a-real-credential"
})

afterEach(() => {
  delete process.env.IPAPI_KEY
})

describe("it places an IP and blocks on the result", () => {
  it("resolves a US state the edge could not", async () => {
    mockedIpApi.mockResolvedValue({ country_code: "US", region_code: "WA" })

    expect(await resolveGeoByIp(PUBLIC_IP)).toEqual({ country: "US", regionCode: "WA" })
  })

  it("BLOCKS Washington — the end-to-end assertion, not the block list", async () => {
    mockedIpApi.mockResolvedValue({ country_code: "US", region_code: "WA" })

    const geo = await resolveGeoByIp(PUBLIC_IP)

    expect(geo?.regionCode).not.toBeNull()
    expect(isFullyBlocked(geo?.regionCode as string)).toBe(true)
  })

  it("REFUSES a full region name rather than passing it to the gate", async () => {
    // Shared with detectUserState via geoIpParse. isFullyBlocked("WASHINGTON")
    // is false, so a name reaching the gate reads as unrestricted.
    mockedIpApi.mockResolvedValue({ country_code: "US", region: "Washington" })

    const geo = await resolveGeoByIp(PUBLIC_IP)

    expect(geo?.regionCode).toBeNull()
    expect(isFullyBlocked(geo?.regionCode as string)).toBe(false)
  })
})

describe("call count — the property the middleware depends on", () => {
  it("calls the vendor ONCE for repeated requests from the same IP", async () => {
    mockedIpApi.mockResolvedValue({ country_code: "US", region_code: "WA" })

    for (let i = 0; i < 25; i++) await resolveGeoByIp(PUBLIC_IP)

    expect(mockedIpApi).toHaveBeenCalledTimes(1)
  })

  it("dedups the PARALLEL requests of a single page load into one call", async () => {
    // ⚠ The load-bearing one. A page load fires the document, the chunks and
    // several API calls at once; every one enters middleware with the same IP
    // and an empty cache. Without in-flight dedup that is a dozen simultaneous
    // vendor calls for one visitor.
    let resolveFetch: (v: Record<string, unknown>) => void = () => {}
    mockedIpApi.mockReturnValue(
      new Promise((res) => {
        resolveFetch = res as (v: Record<string, unknown>) => void
      }),
    )

    const all = Promise.all(Array.from({ length: 12 }, () => resolveGeoByIp(PUBLIC_IP)))
    expect(geoIpCacheStats().inFlight).toBe(1)
    resolveFetch({ country_code: "US", region_code: "WA" })

    const results = await all
    expect(mockedIpApi).toHaveBeenCalledTimes(1)
    expect(results.every((r) => r?.regionCode === "WA")).toBe(true)
    expect(geoIpCacheStats().inFlight).toBe(0)
  })

  it("caches a MISS too, so an unplaceable IP does not retry on every request", async () => {
    mockedIpApi.mockResolvedValue(null)

    for (let i = 0; i < 10; i++) expect(await resolveGeoByIp(PUBLIC_IP)).toBeNull()

    expect(mockedIpApi).toHaveBeenCalledTimes(1)
  })

  it("never calls the vendor for a private or loopback address", async () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.9", "::1", "169.254.1.1"]) {
      expect(await resolveGeoByIp(ip)).toBeNull()
    }
    expect(mockedIpApi).not.toHaveBeenCalled()
  })

  it("does not call the vendor when no key is configured", async () => {
    delete process.env.IPAPI_KEY

    expect(await resolveGeoByIp(PUBLIC_IP)).toBeNull()
    expect(mockedIpApi).not.toHaveBeenCalled()
  })
})

describe("isPublicIp", () => {
  it("accepts routable addresses and rejects the private ranges", () => {
    expect(isPublicIp("166.205.54.18")).toBe(true)
    expect(isPublicIp("8.8.8.8")).toBe(true)
    expect(isPublicIp("172.32.0.1")).toBe(true) // just outside 172.16/12
    expect(isPublicIp("172.16.0.1")).toBe(false)
    expect(isPublicIp("172.31.255.254")).toBe(false)
    expect(isPublicIp("10.1.2.3")).toBe(false)
    expect(isPublicIp("")).toBe(false)
    expect(isPublicIp("   ")).toBe(false)
  })
})

describe("it fails open, and stops hammering a vendor that is down", () => {
  it("returns null rather than throwing when the lookup rejects", async () => {
    mockedIpApi.mockRejectedValue(new Error("network down"))

    await expect(resolveGeoByIp(PUBLIC_IP)).resolves.toBeNull()
  })

  it("opens the breaker after repeated failures and stops calling", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mockedIpApi.mockRejectedValue(new Error("network down"))

    // Distinct IPs, so the negative cache is not what is being measured.
    for (let i = 0; i < 5; i++) await resolveGeoByIp(`203.0.113.${i}`)
    expect(mockedIpApi).toHaveBeenCalledTimes(5)
    expect(geoIpCacheStats().breakerOpen).toBe(true)

    // Further IPs are refused locally — no further vendor calls.
    for (let i = 10; i < 15; i++) expect(await resolveGeoByIp(`203.0.113.${i}`)).toBeNull()
    expect(mockedIpApi).toHaveBeenCalledTimes(5)

    warn.mockRestore()
  })

  it("says so once when it opens the breaker", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mockedIpApi.mockRejectedValue(new Error("network down"))

    for (let i = 0; i < 5; i++) await resolveGeoByIp(`198.51.100.${i}`)

    const opened = warn.mock.calls.filter((c) => String(c[0]).includes("pausing lookups"))
    expect(opened).toHaveLength(1)
    warn.mockRestore()
  })

  it("does not open the breaker when failures are not consecutive", async () => {
    mockedIpApi.mockRejectedValueOnce(new Error("blip"))
    mockedIpApi.mockResolvedValueOnce({ country_code: "US", region_code: "WA" })
    mockedIpApi.mockRejectedValueOnce(new Error("blip"))
    mockedIpApi.mockResolvedValueOnce({ country_code: "US", region_code: "NV" })

    await resolveGeoByIp("203.0.113.1")
    await resolveGeoByIp("203.0.113.2")
    await resolveGeoByIp("203.0.113.3")
    await resolveGeoByIp("203.0.113.4")

    expect(geoIpCacheStats().breakerOpen).toBe(false)
  })
})

describe("the cache is bounded", () => {
  it("does not grow past its cap", async () => {
    mockedIpApi.mockResolvedValue({ country_code: "US", region_code: "WA" })

    for (let i = 0; i < 300; i++) await resolveGeoByIp(`198.18.${Math.floor(i / 256)}.${i % 256}`)

    expect(geoIpCacheStats().entries).toBeLessThanOrEqual(10_000)
    expect(geoIpCacheStats().entries).toBe(300)
  })
})
