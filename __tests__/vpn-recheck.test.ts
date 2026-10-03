// @vitest-environment node
/**
 * "I turned my VPN off and it still says VPN" — reported 2026-09-28 from the
 * owner's iPhone. Pressing "try again" reloaded an identical page, because the
 * page could not say WHAT was still hiding the connection (usually Safari's
 * iCloud Private Relay, still on after the VPN app is off) and the button never
 * asked whether anything had changed.
 *
 * These pin the three halves of the fix: the redirect names the kind, the
 * status endpoint answers over a VPN and can skip a cached block, and the
 * forced recheck cannot be used to burn the vendor quota.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }))
vi.mock("@/lib/geo/geoIpFetch", () => ({ fetchIpApi: vi.fn(), fetchProxycheck: vi.fn() }))
// No Private Relay feed stored: every relay user is refused, the rule these tests pin.
// __tests__/private-relay-placement.test.ts covers the feed being present.
vi.mock("@/lib/geo/privateRelayEdge", () => ({ getRelayRangeSetEdge: vi.fn(async () => null) }))
vi.mock("@/lib/geo/privateRelayStore", () => ({ getRelayRangeSetNode: vi.fn(async () => null) }))

import { getToken } from "next-auth/jwt"
import { middleware } from "@/middleware"
import { GET as vpnStatus } from "@/app/api/geo/vpn-status/route"
import { __resetAnonymizerCache, resolveAnonymizerDetailByIp } from "@/lib/geo/anonymizerCache"
import { fetchIpApi, fetchProxycheck } from "@/lib/geo/geoIpFetch"
import { combineAnonymizerDetail, parseIpApiPayload, parseProxycheckPayload } from "@/lib/geo/geoIpParse"

const mockedProxycheck = vi.mocked(fetchProxycheck)

/** RFC 5737 documentation addresses — never a real user's. */
const VPN_IP = "198.51.100.71"
const RELAY_IP = "198.51.100.72"
const DATACENTRE_IP = "198.51.100.73"
const HOME_IP = "198.51.100.74"

const ENV_KEYS = ["NEXTAUTH_SECRET", "PROXYCHECK_API_KEY", "IPAPI_KEY", "CF_ORIGIN_AUTH_SECRET", "CF_ORIGIN_LOCK_MODE"] as const
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

let verdicts: Record<string, Record<string, unknown>>

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  __resetAnonymizerCache()
  process.env.NEXTAUTH_SECRET = "test-nextauth-secret-not-a-real-credential"
  process.env.PROXYCHECK_API_KEY = "test-proxycheck-key-not-real"
  delete process.env.IPAPI_KEY
  delete process.env.CF_ORIGIN_AUTH_SECRET
  delete process.env.CF_ORIGIN_LOCK_MODE
  vi.mocked(getToken).mockResolvedValue(null)
  vi.mocked(fetchIpApi).mockResolvedValue(null)
  verdicts = {
    [VPN_IP]: { proxy: "yes", type: "VPN", asn: "AS9009", provider: "M247 Europe SRL" },
    // proxycheck typing a relay egress "VPN" must still read as the RELAY — its fix is different.
    [RELAY_IP]: { proxy: "yes", type: "VPN", asn: "AS36183", provider: "Akamai Technologies, Inc." },
    [DATACENTRE_IP]: { proxy: "no", type: "Hosting", asn: "AS8075", provider: "Microsoft Corporation" },
    [HOME_IP]: { proxy: "no", type: "Residential", asn: "AS7922", provider: "Comcast Cable Communications, LLC" },
  }
  mockedProxycheck.mockImplementation(async (ip: string) => ({ status: "ok", [ip]: verdicts[ip] }))
})

afterAll(() => {
  vi.useRealTimers()
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

function request(path: string, ip: string, country = "US") {
  return new NextRequest(new URL(`https://www.allfantasy.ai${path}`), {
    headers: { "cf-ipcountry": country, "cf-region-code": "OR", "cf-connecting-ip": ip },
  })
}

async function statusFor(ip: string, recheck = false, country = "US") {
  const res = await vpnStatus(
    new Request(`https://www.allfantasy.ai/api/geo/vpn-status${recheck ? "?recheck=1" : ""}`, {
      headers: { "cf-ipcountry": country, "cf-connecting-ip": ip },
    }),
  )
  expect(res.headers.get("cache-control")).toContain("no-store")
  return (await res.json()) as { blocked: boolean; kind: string | null }
}

describe("the redirect says what was seen", () => {
  for (const [ip, why] of [
    [VPN_IP, "vpn"],
    [RELAY_IP, "privacy_relay"],
    [DATACENTRE_IP, "hosting"],
  ] as const) {
    it(`why=${why}`, async () => {
      const res = await middleware(request("/login", ip))
      const location = new URL(res.headers.get("location")!)
      expect(location.pathname).toBe("/vpn-blocked")
      expect(location.searchParams.get("why")).toBe(why)
      expect(location.searchParams.get("from")).toBe("/login")
    })
  }

  it("why=tor from the edge header alone", async () => {
    const res = await middleware(request("/login", HOME_IP, "T1"))
    expect(new URL(res.headers.get("location")!).searchParams.get("why")).toBe("tor")
  })

  it("puts the kind on an API refusal too", async () => {
    const res = await middleware(request("/api/leagues/abc/matchups", VPN_IP))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: "VPN_BLOCKED", kind: "vpn" })
  })
})

describe("/api/geo/vpn-status", () => {
  it("is reachable over a VPN — the middleware must not refuse the thing that explains the refusal", async () => {
    const res = await middleware(request("/api/geo/vpn-status?recheck=1", VPN_IP))
    expect(res.status).not.toBe(403)
    expect(res.headers.get("location")).toBeNull()
  })

  it("reports the kind while blocked, and clear on a home connection", async () => {
    expect(await statusFor(RELAY_IP)).toMatchObject({ blocked: true, kind: "privacy_relay" })
    expect(await statusFor(HOME_IP)).toMatchObject({ blocked: false, kind: null })
    expect(await statusFor(HOME_IP, false, "T1")).toMatchObject({ blocked: true, kind: "tor" })
  })

  it("never returns the vendor payload", async () => {
    const body = await statusFor(VPN_IP)
    expect(Object.keys(body).sort()).toEqual(["blocked", "checkedAt", "kind"])
  })

  it("recheck=1 re-asks about a cached block, so a fixed connection on the SAME address gets in", async () => {
    expect((await statusFor(DATACENTRE_IP)).blocked).toBe(true)
    // The vendor corrects itself (or the person's network changed behind one NAT address).
    verdicts[DATACENTRE_IP] = { proxy: "no", type: "Residential", asn: "AS7922", provider: "Comcast" }
    expect((await statusFor(DATACENTRE_IP)).blocked).toBe(true) // a plain read replays the cache
    expect((await statusFor(DATACENTRE_IP, true)).blocked).toBe(false)
    expect(mockedProxycheck).toHaveBeenCalledTimes(2)
  })
})

describe("the forced recheck cannot burn the vendor quota", () => {
  it("re-asks at most once per 10s per address", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-28T12:00:00Z"))
    await resolveAnonymizerDetailByIp(VPN_IP)
    for (let i = 0; i < 5; i++) await resolveAnonymizerDetailByIp(VPN_IP, { fresh: true })
    expect(mockedProxycheck).toHaveBeenCalledTimes(2)
    vi.setSystemTime(new Date("2026-09-28T12:00:11Z"))
    await resolveAnonymizerDetailByIp(VPN_IP, { fresh: true })
    expect(mockedProxycheck).toHaveBeenCalledTimes(3)
  })

  it("never re-asks about a cached CLEAR — it cannot trap anyone", async () => {
    await resolveAnonymizerDetailByIp(HOME_IP)
    await resolveAnonymizerDetailByIp(HOME_IP, { fresh: true })
    expect(mockedProxycheck).toHaveBeenCalledTimes(1)
  })
})

describe("classification", () => {
  const pc = (entry: Record<string, unknown>) => parseProxycheckPayload({ status: "ok", "1.2.3.4": entry }, "1.2.3.4")

  it("reads each proxycheck type as its kind", () => {
    expect(pc({ proxy: "yes", type: "TOR" }).kind).toBe("tor")
    expect(pc({ proxy: "yes", type: "VPN" }).kind).toBe("vpn")
    expect(pc({ proxy: "no", type: "Hosting" }).kind).toBe("hosting")
    expect(pc({ proxy: "yes", type: "SOCKS5" }).kind).toBe("proxy")
    expect(pc({ proxy: "no", type: "Residential" })).toMatchObject({ anonymized: false, kind: null })
  })

  it("reads an ipapi relay network as a relay before its other hints", () => {
    expect(parseIpApiPayload({ country_code: "US", org: "Akamai Technologies hosting", asn: "AS36183" }).vpnKind).toBe(
      "privacy_relay",
    )
    expect(parseIpApiPayload({ country_code: "US", org: "Some VPN Ltd" }).vpnKind).toBe("vpn")
    expect(parseIpApiPayload({ country_code: "US", org: "Comcast" })).toMatchObject({ vpnHint: false, vpnKind: null })
  })

  it("keeps the boolean rule unchanged", () => {
    expect(combineAnonymizerDetail({ tor: false, proxycheck: null, ipapi: null })).toEqual({ anonymized: null, kind: null })
    // `decidedBy` (2026-10-02) names the signal for the block log; the verdict itself is unchanged.
    expect(combineAnonymizerDetail({ tor: true, proxycheck: null, ipapi: null })).toEqual({
      anonymized: true,
      kind: "tor",
      decidedBy: "tor",
    })
  })
})
