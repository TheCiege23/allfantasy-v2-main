// @vitest-environment node
/**
 * iCloud Private Relay users are placed by Apple's published state instead of
 * being refused as a VPN — under the owner's rule (2026-09-28):
 *
 *   Pacific time (CA, OR, NV, WA, and ID)  → still refused: could be Washington
 *   Mountain time (AZ, CO, MT, NM, UT, WY) → free product yes, paid features no
 *   everywhere else                         → placed; ordinary state rules apply
 *
 * and every uncertainty (no feed, address not listed, conflicting listing)
 * falls back to REFUSED, which is the behaviour before this existed.
 *
 * Drives the real middleware, the real routes and the real detectUserState, with
 * the vendor calls and the feed loaders mocked — the failure worth guarding is
 * whether the code that uses the rule is reachable, not the helper alone.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }))
vi.mock("@/lib/geo/geoIpFetch", () => ({ fetchIpApi: vi.fn(), fetchProxycheck: vi.fn() }))
vi.mock("@/lib/geo/privateRelayEdge", () => ({
  getRelayRangeSetEdge: vi.fn(),
  PRIVATE_RELAY_RANGES_PATH: "/api/geo/private-relay-ranges",
}))
vi.mock("@/lib/geo/privateRelayStore", () => ({
  getRelayRangeSetNode: vi.fn(),
  readStoredRelayRanges: vi.fn(),
  writeStoredRelayRanges: vi.fn(),
}))
vi.mock("@/lib/geo/privateRelayFetch", () => ({ fetchPrivateRelayEgressCsv: vi.fn() }))

import { getToken } from "next-auth/jwt"
import { middleware } from "@/middleware"
import { GET as vpnStatusRoute } from "@/app/api/geo/vpn-status/route"
import { GET as relayRangesRoute } from "@/app/api/geo/private-relay-ranges/route"
import { __resetAnonymizerCache } from "@/lib/geo/anonymizerCache"
import { detectUserState } from "@/lib/geo/detectUserState"
import { enforcePaidSubscriptionGeo } from "@/lib/geo/enforcePaidSubscriptionGeo"
import { fetchIpApi, fetchProxycheck } from "@/lib/geo/geoIpFetch"
import { getRelayRangeSetEdge } from "@/lib/geo/privateRelayEdge"
import { fetchPrivateRelayEgressCsv } from "@/lib/geo/privateRelayFetch"
import { refreshPrivateRelayRanges } from "@/lib/geo/privateRelayIngest"
import {
  decideRelay,
  lookupRelayState,
  parseEgressGeofeed,
  relayZoneForState,
  type RelayRangeSet,
} from "@/lib/geo/privateRelayRanges"
import { getRelayRangeSetNode, readStoredRelayRanges, writeStoredRelayRanges } from "@/lib/geo/privateRelayStore"
import { INTERNAL_HOP_HEADER, signInternalHop } from "@/lib/http/internalHop"

const mockedProxycheck = vi.mocked(fetchProxycheck)
const mockedEdge = vi.mocked(getRelayRangeSetEdge)
const mockedNode = vi.mocked(getRelayRangeSetNode)

/** RFC 5737 documentation addresses — never a real user's. */
const RELAY_NY = "198.51.100.10"
const RELAY_CA = "198.51.100.20"
const RELAY_CO = "198.51.100.30"
const RELAY_HI = "198.51.100.40"
const RELAY_ID = "198.51.100.50"
const RELAY_UNLISTED = "198.51.100.60"
const VPN_UNLISTED = "198.51.100.70"
/** Apple's address that a VPN vendor mislabels as a commercial VPN — Apple's listing wins. */
const RELAY_MISLABELLED_TX = "198.51.100.80"
const RELAY_V6_NY = "2001:db8:aa00:1::7"

const FEED = [
  "# prefix,country,region,city,postal",
  "198.51.100.8/30,US,US-NY,New York,",
  "198.51.100.20/32,US,US-CA,Los Angeles,",
  "198.51.100.30/32,US,US-CO,Denver,",
  "198.51.100.40/32,US,US-HI,Honolulu,",
  "198.51.100.50/32,US,US-ID,Boise,",
  "198.51.100.80/32,US,US-TX,Dallas,",
  "2001:db8:aa00::/48,US,US-NY,New York,",
  "203.0.113.0/24,GB,GB-ENG,London,",
].join("\n")
const SET: RelayRangeSet = parseEgressGeofeed(FEED, new Date("2026-09-28T00:00:00Z")).set

const RELAY_ENTRY = { proxy: "no", type: "Business", asn: "AS36183", provider: "Akamai Technologies, Inc." }
const VERDICTS: Record<string, Record<string, unknown>> = {
  [RELAY_NY]: RELAY_ENTRY,
  [RELAY_CA]: RELAY_ENTRY,
  [RELAY_CO]: RELAY_ENTRY,
  [RELAY_HI]: RELAY_ENTRY,
  [RELAY_ID]: RELAY_ENTRY,
  [RELAY_UNLISTED]: RELAY_ENTRY,
  [RELAY_V6_NY]: RELAY_ENTRY,
  [VPN_UNLISTED]: { proxy: "yes", type: "VPN", asn: "AS9009", provider: "M247 Europe SRL" },
  [RELAY_MISLABELLED_TX]: { proxy: "yes", type: "VPN", asn: "AS714", provider: "Apple Inc." },
}

const AUTH_SECRET = "test-nextauth-secret-not-a-real-credential"
const ENV_KEYS = ["NEXTAUTH_SECRET", "PROXYCHECK_API_KEY", "IPAPI_KEY", "CF_ORIGIN_AUTH_SECRET", "CF_ORIGIN_LOCK_MODE"] as const
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

beforeEach(() => {
  vi.clearAllMocks()
  __resetAnonymizerCache()
  process.env.NEXTAUTH_SECRET = AUTH_SECRET
  process.env.PROXYCHECK_API_KEY = "test-proxycheck-key-not-real"
  delete process.env.IPAPI_KEY
  delete process.env.CF_ORIGIN_AUTH_SECRET
  delete process.env.CF_ORIGIN_LOCK_MODE
  vi.mocked(getToken).mockResolvedValue(null)
  vi.mocked(fetchIpApi).mockResolvedValue(null)
  mockedProxycheck.mockImplementation(async (ip: string) => ({ status: "ok", [ip]: VERDICTS[ip] }))
  mockedEdge.mockResolvedValue(SET)
  mockedNode.mockResolvedValue(SET)
})

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

/** Cloudflare's own reading of the relay address — deliberately NOT the state Apple lists. */
function request(path: string, ip: string, method = "GET", cfRegion = "PA") {
  return new NextRequest(new URL(`https://www.allfantasy.ai${path}`), {
    method,
    headers: { "cf-ipcountry": "US", "cf-region-code": cfRegion, "cf-connecting-ip": ip },
  })
}

function location(res: Response): URL | null {
  const l = res.headers.get("location")
  return l ? new URL(l) : null
}

describe("the feed", () => {
  it("keeps US rows only, merges touching ranges, and looks up v4, v6 and v4-mapped v6", () => {
    expect(SET.states).toEqual(["CA", "CO", "HI", "ID", "NY", "TX"])
    expect(lookupRelayState(SET, RELAY_NY)).toBe("NY")
    expect(lookupRelayState(SET, "198.51.100.11")).toBe("NY") // inside the /30
    expect(lookupRelayState(SET, "198.51.100.12")).toBeNull() // just past it
    expect(lookupRelayState(SET, `::ffff:${RELAY_CO}`)).toBe("CO")
    expect(lookupRelayState(SET, RELAY_V6_NY)).toBe("NY")
    expect(lookupRelayState(SET, "2001:db8:ab00::1")).toBeNull()
    expect(lookupRelayState(SET, "203.0.113.5")).toBeNull() // London: not US, not kept
    expect(lookupRelayState(SET, "not-an-ip")).toBeNull()
  })

  it("trusts neither state when the feed lists one address twice", () => {
    const { set } = parseEgressGeofeed(
      ["192.0.2.0/24,US,US-NY,New York,", "192.0.2.128/25,US,US-WA,Seattle,", "192.0.2.0/24,US,US-NY,,"].join("\n"),
      new Date(),
    )
    expect(lookupRelayState(set, "192.0.2.200")).toBeNull()
    expect(lookupRelayState(set, "192.0.2.5")).toBeNull()
  })

  it("counts lines it could not read instead of guessing", () => {
    const { stats } = parseEgressGeofeed("garbage,US,US-NY,,\n10.0.0.0/8,US,Washington,,\n1.2.3.4/32,US,US-OH,,", new Date())
    expect(stats).toEqual({ lines: 3, usLines: 1, invalid: 2 })
  })
})

describe("the owner's rule", () => {
  it("refuses every Pacific-time state, Idaho included", () => {
    for (const s of ["CA", "OR", "NV", "WA", "ID"]) {
      expect(relayZoneForState(s), s).toBe("pacific")
      expect(decideRelay(s).kind, s).toBe("blocked")
    }
  })

  it("places Mountain-time states with paid features off", () => {
    for (const s of ["AZ", "CO", "MT", "NM", "UT", "WY"]) expect(decideRelay(s), s).toEqual({ kind: "placed", state: s, paidBlocked: true })
  })

  it("places everywhere else normally, and an unlisted address stays refused", () => {
    for (const s of ["NY", "TX", "FL", "IL", "HI", "AK"]) expect(decideRelay(s), s).toEqual({ kind: "placed", state: s, paidBlocked: false })
    expect(decideRelay(null)).toEqual({ kind: "blocked", state: null })
  })
})

describe("the middleware gate", () => {
  it("lets a New York relay user sign in, and uses Apple's state rather than the edge's", async () => {
    const page = await middleware(request("/login", RELAY_NY))
    expect(location(page)).toBeNull()
    expect(page.headers.get("x-user-state")).toBe("NY")
    const api = await middleware(request("/api/leagues/abc/matchups", RELAY_NY, "POST"))
    expect(api.status).not.toBe(403)
  })

  it("places an IPv6 relay address", async () => {
    expect(location(await middleware(request("/login", RELAY_V6_NY)))).toBeNull()
  })

  it("still refuses a California relay user — they could be in Washington", async () => {
    const res = await middleware(request("/login", RELAY_CA))
    expect(location(res)?.pathname).toBe("/vpn-blocked")
    expect(location(res)?.searchParams.get("why")).toBe("privacy_relay")
    expect(location(res)?.searchParams.get("scope")).toBeNull()
  })

  it("still refuses an Idaho relay user (the panhandle is on Pacific time)", async () => {
    expect(location(await middleware(request("/login", RELAY_ID)))?.pathname).toBe("/vpn-blocked")
  })

  it("lets a Colorado relay user in, but not onto paid features", async () => {
    expect(location(await middleware(request("/login", RELAY_CO)))).toBeNull()
    const paidApi = await middleware(request("/api/user/autocoach", RELAY_CO, "POST"))
    expect(paidApi.status).toBe(451)
    expect(await paidApi.json()).toMatchObject({ error: "PAID_GEO_BLOCKED", reason: "private_relay", allowFree: true })
    const freeApi = await middleware(request("/api/leagues/abc/matchups", RELAY_CO, "POST"))
    expect(freeApi.status).not.toBe(451)
    expect(freeApi.status).not.toBe(403)
  })

  it("sends a Colorado relay user on a paid PAGE to the paid-only relay page", async () => {
    vi.mocked(getToken).mockResolvedValue({ sub: "user-1", username: "someone" } as never)
    const res = await middleware(request("/league/abc/dispersal-draft", RELAY_CO))
    expect(location(res)?.pathname).toBe("/vpn-blocked")
    expect(location(res)?.searchParams.get("scope")).toBe("paid")
    expect(location(res)?.searchParams.get("why")).toBe("privacy_relay")
  })

  it("applies Hawaii's own paid rule to a Hawaii relay user — Apple's HI, not the edge's PA", async () => {
    expect(location(await middleware(request("/login", RELAY_HI)))).toBeNull()
    const paid = await middleware(request("/api/user/autocoach", RELAY_HI, "POST"))
    expect(paid.status).toBe(451)
    expect(await paid.json()).toMatchObject({ error: "PAID_GEO_BLOCKED", stateCode: "HI" })
  })

  it("trusts Apple's listing over a vendor that calls the address a VPN", async () => {
    expect(location(await middleware(request("/login", RELAY_MISLABELLED_TX)))).toBeNull()
  })

  it("refuses a relay address the feed does not list", async () => {
    expect(location(await middleware(request("/login", RELAY_UNLISTED)))?.pathname).toBe("/vpn-blocked")
  })

  it("refuses an ordinary VPN exactly as before", async () => {
    const res = await middleware(request("/login", VPN_UNLISTED))
    expect(location(res)?.searchParams.get("why")).toBe("vpn")
  })

  it("refuses every relay user when no feed is available — the old behaviour, never looser", async () => {
    mockedEdge.mockResolvedValue(null)
    expect(location(await middleware(request("/login", RELAY_NY)))?.pathname).toBe("/vpn-blocked")
    mockedEdge.mockRejectedValue(new Error("boom"))
    expect(location(await middleware(request("/login", RELAY_NY)))?.pathname).toBe("/vpn-blocked")
  })

  it("asks for the feed at the served origin, never the Railway bind address", async () => {
    // Production shape: Next builds request.url from the bind address.
    const req = new NextRequest(new URL("https://0.0.0.0:8080/login"), {
      headers: { host: "www.allfantasy.ai", "cf-ipcountry": "US", "cf-region-code": "PA", "cf-connecting-ip": RELAY_NY },
    })
    expect(location(await middleware(req))).toBeNull()
    expect(mockedEdge).toHaveBeenCalledTimes(1)
    const origin = mockedEdge.mock.calls[0]![0]
    expect(origin).not.toContain("0.0.0.0")
    expect(new URL(origin).protocol).toBe("https:")
  })

  it("never asks for the feed for an ordinary visitor", async () => {
    VERDICTS["198.51.100.99"] = { proxy: "no", type: "Residential", asn: "AS7922", provider: "Comcast" }
    await middleware(request("/login", "198.51.100.99"))
    expect(mockedEdge).not.toHaveBeenCalled()
  })
})

describe("/api/geo/vpn-status", () => {
  async function status(ip: string, query = "") {
    const res = await vpnStatusRoute(
      new Request(`https://www.allfantasy.ai/api/geo/vpn-status${query}`, {
        headers: { "cf-ipcountry": "US", "cf-connecting-ip": ip },
      }),
    )
    return (await res.json()) as { blocked: boolean; kind: string | null }
  }

  it("agrees with the gate", async () => {
    expect(await status(RELAY_NY)).toMatchObject({ blocked: false, kind: null })
    expect(await status(RELAY_CA)).toMatchObject({ blocked: true, kind: "privacy_relay" })
  })

  it("answers for paid pages when asked with scope=paid", async () => {
    expect(await status(RELAY_CO)).toMatchObject({ blocked: false })
    expect(await status(RELAY_CO, "?scope=paid")).toMatchObject({ blocked: true, kind: "privacy_relay" })
    expect(await status(RELAY_NY, "?scope=paid")).toMatchObject({ blocked: false })
  })
})

describe("signup and checkout agree with the gate", () => {
  const req = (ip: string) => new Request("https://www.allfantasy.ai/x", { headers: { "cf-ipcountry": "US", "cf-region-code": "PA", "cf-connecting-ip": ip } })

  it("places a New York relay user for signup", async () => {
    expect(await detectUserState(req(RELAY_NY))).toMatchObject({ isVpnOrProxy: false, stateCode: "NY", privateRelay: { state: "NY", paidBlocked: false } })
  })

  it("keeps a California relay user refused", async () => {
    expect(await detectUserState(req(RELAY_CA))).toMatchObject({ isVpnOrProxy: true })
  })

  it("refuses checkout for a Colorado relay user, and allows the billing portal", async () => {
    const res = await enforcePaidSubscriptionGeo(req(RELAY_CO))
    expect(res?.status).toBe(451)
    expect(await res!.json()).toMatchObject({ error: "VPN_BLOCKED", kind: "privacy_relay" })
    expect(await enforcePaidSubscriptionGeo(req(RELAY_CO), { blockVpnOrProxy: false })).toBeNull()
  })

  it("lets a New York relay user check out", async () => {
    expect(await enforcePaidSubscriptionGeo(req(RELAY_NY))).toBeNull()
  })
})

describe("/api/geo/private-relay-ranges", () => {
  const path = "/api/geo/private-relay-ranges"
  const call = (headers: Record<string, string> = {}) => relayRangesRoute(new Request(`https://www.allfantasy.ai${path}`, { headers }))

  it("refuses anyone but our own server", async () => {
    expect((await call()).status).toBe(403)
    expect((await call({ [INTERNAL_HOP_HEADER]: "123.abc" })).status).toBe(403)
  })

  it("serves the stored set to a signed internal hop, and 404s when none is stored", async () => {
    const token = (await signInternalHop("GET", path, AUTH_SECRET))!
    const ok = await call({ [INTERNAL_HOP_HEADER]: token })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual(SET)
    mockedNode.mockResolvedValue(null)
    expect((await call({ [INTERNAL_HOP_HEADER]: token })).status).toBe(404)
  })
})

describe("the daily refresh", () => {
  const mockedFetch = vi.mocked(fetchPrivateRelayEgressCsv)
  const mockedRead = vi.mocked(readStoredRelayRanges)
  const mockedWrite = vi.mocked(writeStoredRelayRanges)
  const now = new Date("2026-09-28T12:00:00Z")

  /** 600 non-touching /32s, so nothing merges and the count is exact. */
  const bigFeed = Array.from({ length: 600 }, (_, i) => `10.${Math.floor(i / 100)}.${(i % 100) * 2}.1/32,US,US-OH,Columbus,`).join("\n")

  it("does nothing while the stored set is under 20 hours old", async () => {
    mockedRead.mockResolvedValue({ ...SET, fetchedAt: new Date(now.getTime() - 3 * 3600_000).toISOString() })
    expect(await refreshPrivateRelayRanges({ now })).toMatchObject({ status: "fresh" })
    expect(mockedFetch).not.toHaveBeenCalled()
  })

  it("fetches, parses and stores a stale set", async () => {
    mockedRead.mockResolvedValue({ ...SET, fetchedAt: new Date(now.getTime() - 21 * 3600_000).toISOString() })
    mockedFetch.mockResolvedValue(bigFeed)
    expect(await refreshPrivateRelayRanges({ now })).toMatchObject({ status: "refreshed", ranges: 600, states: 1 })
    expect(mockedWrite).toHaveBeenCalledTimes(1)
  })

  it("never overwrites a good set with a broken download", async () => {
    mockedRead.mockResolvedValue(null)
    mockedFetch.mockResolvedValue("<html>error</html>")
    expect(await refreshPrivateRelayRanges({ now })).toMatchObject({ status: "failed" })
    mockedFetch.mockResolvedValue(null)
    expect(await refreshPrivateRelayRanges({ now })).toMatchObject({ status: "failed" })
    expect(mockedWrite).not.toHaveBeenCalled()
  })
})
