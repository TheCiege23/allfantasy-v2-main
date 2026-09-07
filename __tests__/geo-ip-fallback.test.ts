// @vitest-environment node
/**
 * Pins the IP-geolocation fallback that `detectUserState` uses when NO edge
 * placed the request.
 *
 * Why this file exists. Measured 2026-09-07: neither allfantasy.ai nor
 * www.allfantasy.ai was proxied through Cloudflare, so `cf-ipcountry` was absent
 * on every request, `resolveEdgeGeo` returned `unknown`, and the resulting null
 * state code silently disabled THREE gates — page access in middleware, account
 * creation in /api/auth/register, and the VPN-from-restricted-state check. The
 * ipapi.co response that would have answered it was already being fetched on
 * every signup and read for one field.
 *
 * ⚠ THE ASSERTIONS ARE ABOUT WHAT GETS ENFORCED, not about the parse. The
 * outage this repo already survived was invisible precisely because the tests
 * asserted that the block list contained Washington rather than that a
 * Washington request gets blocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/geo/geoIpFetch", () => ({
  fetchIpApi: vi.fn(),
  fetchProxycheck: vi.fn(),
}))

import { detectUserState, __resetIpApiShapeWarning } from "@/lib/geo/detectUserState"
import { __resetGeoHeaderWarning } from "@/lib/geo/geoHeaders"
import { fetchIpApi, fetchProxycheck } from "@/lib/geo/geoIpFetch"
import { isFullyBlocked, isPaidBlocked } from "@/lib/geo/restrictedStates"

const mockedIpApi = vi.mocked(fetchIpApi)
const mockedProxycheck = vi.mocked(fetchProxycheck)

/** A request that reached the origin with no edge in front of it — production on 2026-09-07. */
const unplaced = (ip = "166.205.54.18") => new Headers({ "x-real-ip": ip })

/** What Cloudflare puts on a proxied request with visitor location headers on. */
const cloudflare = (country: string, region?: string) =>
  new Headers({
    "cf-ipcountry": country,
    ...(region ? { "cf-region-code": region } : {}),
    "x-real-ip": "203.0.113.7",
  })

beforeEach(() => {
  __resetGeoHeaderWarning()
  __resetIpApiShapeWarning()
  vi.clearAllMocks()
  process.env.IPAPI_KEY = "test-key-not-a-real-credential"
  delete process.env.PROXYCHECK_API_KEY
  mockedProxycheck.mockResolvedValue(null)
})

afterEach(() => {
  delete process.env.IPAPI_KEY
})

describe("the fallback places a request the edge could not", () => {
  it("resolves a US state from the IP lookup and names ip_api as the source", async () => {
    mockedIpApi.mockResolvedValue({ country_code: "US", region_code: "WA", org: "AT&T Mobility" })

    const geo = await detectUserState(unplaced())

    expect(geo.stateCode).toBe("WA")
    expect(geo.country).toBe("US")
    expect(geo.detectionSource).toBe("ip_api")
  })

  it("BLOCKS Washington on a request shaped like production traffic today", async () => {
    // The end-to-end assertion. Before this change stateCode was null here and
    // isFullyBlocked(null) is false, so the gate did not fire.
    mockedIpApi.mockResolvedValue({ country_code: "US", region_code: "WA" })

    const geo = await detectUserState(unplaced())

    expect(geo.stateCode).not.toBeNull()
    expect(isFullyBlocked(geo.stateCode as string)).toBe(true)
  })

  it("applies the paid-tier block to Nevada through the same path", async () => {
    mockedIpApi.mockResolvedValue({ country_code: "US", region_code: "NV" })

    const geo = await detectUserState(unplaced())

    expect(isPaidBlocked(geo.stateCode as string)).toBe(true)
  })

  it("returns no state for a non-US country, even with a region", async () => {
    mockedIpApi.mockResolvedValue({ country_code: "GB", region_code: "ENG" })

    const geo = await detectUserState(unplaced())

    expect(geo.stateCode).toBeNull()
    expect(geo.country).toBe("GB")
  })
})

describe("the edge header still wins, and costs nothing", () => {
  it("takes the state from the header and adds no vendor call to do it", async () => {
    const geo = await detectUserState(cloudflare("US", "WA"))

    expect(geo.stateCode).toBe("WA")
    expect(geo.detectionSource).toBe("cloudflare_headers")
    // ⚠ NOT "never calls the vendor" — that assertion was written first and was
    // wrong. The pre-existing VPN hint calls ipapi once whenever proxycheck does
    // not answer, header or no header, and this change did not touch that. What
    // it must not do is add a SECOND call for geo when the header already
    // answered, which is what one-call-total pins.
    expect(mockedIpApi).toHaveBeenCalledTimes(1)
  })

  it("makes no vendor call whatsoever when the header answers and proxycheck settles the VPN hint", async () => {
    process.env.PROXYCHECK_API_KEY = "test-key-not-a-real-credential"
    mockedProxycheck.mockResolvedValue({ "203.0.113.7": { proxy: "yes" } })

    const geo = await detectUserState(cloudflare("US", "WA"))

    expect(geo.stateCode).toBe("WA")
    expect(geo.isVpnOrProxy).toBe(true)
    expect(mockedIpApi).not.toHaveBeenCalled()
  })

  it("makes ONE vendor call, not two, when it falls back and also needs the VPN hint", async () => {
    process.env.PROXYCHECK_API_KEY = "test-key-not-a-real-credential"
    mockedProxycheck.mockResolvedValue(null)
    mockedIpApi.mockResolvedValue({ country_code: "US", region_code: "WA", org: "Hosting Provider" })

    const geo = await detectUserState(unplaced())

    expect(geo.isVpnOrProxy).toBe(true)
    expect(mockedIpApi).toHaveBeenCalledTimes(1)
  })
})

describe("it refuses to invent a state", () => {
  it("REFUSES a full region name and reports unknown rather than passing it on", async () => {
    // ⚠ The most important test here. `region` is the full name in most vendor
    // payloads, and isFullyBlocked("WASHINGTON") is FALSE — so letting a name
    // through would report a placed Washington user as unrestricted, which is
    // the same silent failure reached from a new direction.
    mockedIpApi.mockResolvedValue({ country_code: "US", region: "Washington" })

    const geo = await detectUserState(unplaced())

    expect(geo.stateCode).toBeNull()
    expect(isFullyBlocked(geo.stateCode as string)).toBe(false)
    expect(geo.country).toBe("US")
  })

  it("accepts a code in the region field when that is what the vendor sent", async () => {
    mockedIpApi.mockResolvedValue({ country_code: "US", region: "WA" })

    expect((await detectUserState(unplaced())).stateCode).toBe("WA")
  })

  it("normalises a full subdivision path to a bare code", async () => {
    mockedIpApi.mockResolvedValue({ country_code: "US", region_code: "US-WA" })

    expect((await detectUserState(unplaced())).stateCode).toBe("WA")
  })

  it("reports unknown when the vendor says error", async () => {
    mockedIpApi.mockResolvedValue({ error: true, reason: "RateLimited" })

    const geo = await detectUserState(unplaced())

    expect(geo.stateCode).toBeNull()
    expect(geo.country).toBeNull()
    expect(geo.detectionSource).toBe("unknown")
  })

  it("reports unknown when the vendor is unreachable", async () => {
    mockedIpApi.mockResolvedValue(null)

    expect((await detectUserState(unplaced())).detectionSource).toBe("unknown")
  })

  it("reports unknown when there is no IP to look up", async () => {
    const geo = await detectUserState(new Headers())

    expect(geo.detectionSource).toBe("unknown")
    expect(mockedIpApi).not.toHaveBeenCalled()
  })

  it("does not run the lookup when no key is configured", async () => {
    delete process.env.IPAPI_KEY

    expect((await detectUserState(unplaced())).detectionSource).toBe("unknown")
  })
})

describe("a shape change is loud, because it is a different fix from an outage", () => {
  it("says so, once, when the vendor answers 200 with nothing readable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mockedIpApi.mockResolvedValue({ some_future_field: "US", another: "WA" })

    const first = await detectUserState(unplaced())
    await detectUserState(unplaced())

    expect(first.detectionSource).toBe("unknown")
    const shapeWarnings = warn.mock.calls.filter((c) => String(c[0]).includes("no readable country"))
    expect(shapeWarnings).toHaveLength(1)
    // The keys are named so the fix is one read of the log, not a bisect.
    expect(String(shapeWarnings[0]?.[0])).toContain("some_future_field")
    warn.mockRestore()
  })

  it("still returns the VPN hint when only the location half is unreadable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    process.env.PROXYCHECK_API_KEY = "test-key-not-a-real-credential"
    mockedIpApi.mockResolvedValue({ some_future_field: "US", org: "Private Layer VPN" })

    const geo = await detectUserState(unplaced())

    expect(geo.stateCode).toBeNull()
    expect(geo.isVpnOrProxy).toBe(true)
  })
})
