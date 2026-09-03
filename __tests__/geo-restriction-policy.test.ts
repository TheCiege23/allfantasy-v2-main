// @vitest-environment node
/**
 * Pins the geo-restriction policy to the headers the CURRENT edge sends.
 *
 * Why this file exists. On 2026-09-02 production moved from Vercel to Railway
 * behind Cloudflare. Every geo gate read `x-vercel-ip-country`, which no longer
 * arrives, so `country === "US"` was false for every request on earth and all
 * five restricted states became unrestricted. Nothing failed. The suite stayed
 * green, because no test had ever asserted that a Washington request gets
 * blocked — only that the block list contained Washington.
 *
 * So the assertions here are deliberately about the HEADERS AS THE EDGE ACTUALLY
 * SENDS THEM, not about the block list. A list is easy to test and was never the
 * part that broke.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  resolveEdgeGeo,
  resolveUsStateCode,
  __resetGeoHeaderWarning,
} from "@/lib/geo/geoHeaders"
import { detectUserState } from "@/lib/geo/detectUserState"
import { isFullyBlocked, isPaidBlocked } from "@/lib/geo/restrictedStates"

/** What Cloudflare puts on a proxied request with visitor location headers on. */
const cloudflare = (country: string, region?: string) =>
  new Headers({
    "cf-ipcountry": country,
    ...(region ? { "cf-region-code": region } : {}),
    "cf-connecting-ip": "203.0.113.7",
  })

/** What Vercel put on a request, and still does on preview deployments. */
const vercel = (country: string, region?: string) =>
  new Headers({
    "x-vercel-ip-country": country,
    ...(region ? { "x-vercel-ip-country-region": region } : {}),
  })

beforeEach(() => {
  __resetGeoHeaderWarning()
  // Keep VPN lookups out of these tests entirely; they are network calls and
  // are not what is under test here.
  delete process.env.PROXYCHECK_API_KEY
  delete process.env.IPAPI_KEY
})

describe("the outage this file exists to prevent", () => {
  it("resolves a US state from Cloudflare headers", () => {
    // THE REGRESSION TEST. Before the fix this returned null, because nothing
    // read cf-ipcountry, and that single null disabled every restriction.
    expect(resolveUsStateCode(cloudflare("US", "WA"))).toBe("WA")
  })

  it("blocks Washington on a request shaped like production traffic today", () => {
    const state = resolveUsStateCode(cloudflare("US", "WA"))
    expect(state).not.toBeNull()
    expect(isFullyBlocked(state as string)).toBe(true)
  })

  it("applies the paid-tier block to Nevada on the same header shape", () => {
    const state = resolveUsStateCode(cloudflare("US", "NV"))
    expect(isPaidBlocked(state as string)).toBe(true)
    expect(isFullyBlocked(state as string)).toBe(false)
  })

  it("leaves an unrestricted state alone", () => {
    const state = resolveUsStateCode(cloudflare("US", "CA"))
    expect(state).toBe("CA")
    expect(isFullyBlocked(state as string)).toBe(false)
    expect(isPaidBlocked(state as string)).toBe(false)
  })
})

describe("edge sources", () => {
  it("still reads Vercel headers, so preview deployments stay restricted too", () => {
    expect(resolveEdgeGeo(vercel("US", "WA"))).toEqual({
      country: "US",
      regionCode: "WA",
      source: "vercel",
    })
  })

  it("prefers Cloudflare when both are present", () => {
    const headers = cloudflare("US", "WA")
    headers.set("x-vercel-ip-country", "US")
    headers.set("x-vercel-ip-country-region", "CA")

    const geo = resolveEdgeGeo(headers)
    expect(geo.source).toBe("cloudflare")
    expect(geo.regionCode).toBe("WA")
  })

  it("reports unknown when no edge header is present", () => {
    // This is the state production was in during the outage. It is a legitimate
    // answer, not an error — but it must be DISTINGUISHABLE from "not
    // restricted", which is exactly the distinction that was lost.
    expect(resolveEdgeGeo(new Headers())).toEqual({
      country: null,
      regionCode: null,
      source: "unknown",
    })
  })

  it("says so, once, when it cannot place a request", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    resolveEdgeGeo(new Headers())
    resolveEdgeGeo(new Headers())
    resolveEdgeGeo(new Headers())
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain("cf-ipcountry")
    warn.mockRestore()
  })
})

describe("header values that look like data but are not", () => {
  it("treats Cloudflare's XX (unplaceable) as unknown, not as a country", () => {
    expect(resolveEdgeGeo(cloudflare("XX", "WA")).source).toBe("unknown")
  })

  it("treats Cloudflare's T1 (Tor) as unknown", () => {
    expect(resolveEdgeGeo(cloudflare("T1")).source).toBe("unknown")
  })

  it("normalises a full subdivision path to a bare code", () => {
    expect(resolveUsStateCode(cloudflare("US", "US-WA"))).toBe("WA")
  })

  it("uppercases a lowercase region", () => {
    expect(resolveUsStateCode(cloudflare("us", "wa"))).toBe("WA")
  })

  it("ignores an empty header rather than treating it as a value", () => {
    expect(resolveEdgeGeo(new Headers({ "cf-ipcountry": "   " })).source).toBe("unknown")
  })

  it("returns no state for a non-US country, even with a region", () => {
    expect(resolveUsStateCode(cloudflare("GB", "ENG"))).toBeNull()
  })
})

describe("detectUserState reports the same answer as the middleware gate", () => {
  it("places a Cloudflare request and names its source", async () => {
    const geo = await detectUserState(cloudflare("US", "WA"))
    expect(geo.stateCode).toBe("WA")
    expect(geo.country).toBe("US")
    expect(geo.detectionSource).toBe("cloudflare_headers")
  })

  it("reports unknown rather than inventing a state when no edge answered", async () => {
    const geo = await detectUserState(new Headers())
    expect(geo.stateCode).toBeNull()
    expect(geo.country).toBeNull()
    expect(geo.detectionSource).toBe("unknown")
  })

  it("agrees with resolveUsStateCode across every restricted state", async () => {
    for (const code of ["WA", "HI", "ID", "MT", "NV"]) {
      const headers = cloudflare("US", code)
      const geo = await detectUserState(headers)
      expect(geo.stateCode).toBe(resolveUsStateCode(cloudflare("US", code)))
      expect(isFullyBlocked(code) || isPaidBlocked(code)).toBe(true)
    }
  })
})
