// @vitest-environment node
/**
 * A VPN or proxy must not be a way into paid checkout from a restricted state.
 *
 * Why this file exists. Until this change the only VPN check was in signup, and
 * it required the VPN to resolve to a RESTRICTED state:
 *
 *     geo.isVpnOrProxy && geo.stateCode && (isFullyBlocked(...) || isPaidBlocked(...))
 *
 * But the state comes from the very IP the VPN replaces. A Washington user on an
 * Oregon exit resolves to OR, so the condition is false for the one case it
 * exists to catch. Paid checkout never looked at the VPN flag at all.
 *
 * ⚠ AND THE FLAG WAS BEING COMPUTED FOR THE WRONG MACHINE. Measured 2026-09-24
 * against production (Cloudflare -> Railway): `x-forwarded-for` read
 * a Cloudflare `172.69.x` hop and a relay for a client whose public IP was neither —
 * no entry is the user. `extractClientIp` read
 * `x-real-ip` / `x-forwarded-for`, so a proxy check ran against Cloudflare's
 * address. Blocking on that flag would have refused EVERY buyer, which is why
 * the client-IP fix and the block land together and are pinned together here.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/geo/geoIpFetch", () => ({
  fetchIpApi: vi.fn(),
  fetchProxycheck: vi.fn(),
}))

import { detectUserState } from "@/lib/geo/detectUserState"
import { enforcePaidSubscriptionGeo } from "@/lib/geo/enforcePaidSubscriptionGeo"
import { __resetGeoHeaderWarning } from "@/lib/geo/geoHeaders"
import { fetchIpApi, fetchProxycheck } from "@/lib/geo/geoIpFetch"

const mockedIpApi = vi.mocked(fetchIpApi)
const mockedProxycheck = vi.mocked(fetchProxycheck)

/** RFC 5737 documentation address — never a real user's. */
const CLIENT_IP = "198.51.100.23"
/** Stands in for a Cloudflare hop (production showed a 172.69.x address). */
const CLOUDFLARE_HOP = "203.0.113.50"

/** A request as production receives it: placed by Cloudflare, real IP only in cf-connecting-ip. */
function viaCloudflare(region: string, clientIp = CLIENT_IP): Request {
  return new Request("https://www.allfantasy.ai/api/monetization/checkout/subscription", {
    method: "POST",
    headers: {
      "cf-ipcountry": "US",
      "cf-region-code": region,
      "cf-connecting-ip": clientIp,
      "x-forwarded-for": `${CLOUDFLARE_HOP}, 192.0.2.77`,
      "x-real-ip": CLOUDFLARE_HOP,
    },
  })
}

/** proxycheck.io flags exactly the IPs in `flagged`, and nothing else. */
function proxycheckFlags(...flagged: string[]) {
  mockedProxycheck.mockImplementation(async (ip: string) => ({
    status: "ok",
    [ip]: flagged.includes(ip) ? { proxy: "yes", type: "VPN" } : { proxy: "no", type: "Residential" },
  }))
}

beforeEach(() => {
  __resetGeoHeaderWarning()
  vi.clearAllMocks()
  process.env.PROXYCHECK_API_KEY = "test-key-not-a-real-credential"
  delete process.env.IPAPI_KEY
  mockedIpApi.mockResolvedValue(null)
  proxycheckFlags()
})

describe("a VPN blocks paid checkout wherever it appears to be", () => {
  it("BLOCKS a Washington user on an Oregon VPN exit — the case the old check could never catch", async () => {
    proxycheckFlags(CLIENT_IP)
    const res = await enforcePaidSubscriptionGeo(viaCloudflare("OR"))

    expect(res?.status).toBe(451)
    const body = await res!.json()
    expect(body.error).toBe("VPN_BLOCKED")
    expect(body.message).toMatch(/VPN/)
    // The state the VPN claims is not evidence of anything, so it is not echoed back.
    expect(body.stateCode).toBeUndefined()
  })

  it("lets the same Oregon request through when the IP is not a VPN", async () => {
    expect(await enforcePaidSubscriptionGeo(viaCloudflare("OR"))).toBeNull()
  })

  it("still blocks a paid-block state with no VPN, under the existing code", async () => {
    const res = await enforcePaidSubscriptionGeo(viaCloudflare("NV"))
    expect(res?.status).toBe(451)
    expect((await res!.json()).error).toBe("PAID_GEO_BLOCKED")
  })

  it("does NOT block a VPN user when the caller opts out (the billing portal, where people cancel)", async () => {
    proxycheckFlags(CLIENT_IP)
    expect(await enforcePaidSubscriptionGeo(viaCloudflare("OR"), { blockVpnOrProxy: false })).toBeNull()
  })

  it("fails open when the proxy check is unavailable — an outage must not close checkout", async () => {
    mockedProxycheck.mockResolvedValue(null)
    expect(await enforcePaidSubscriptionGeo(viaCloudflare("OR"))).toBeNull()
  })
})

describe("the proxy check is asked about the CLIENT, not the proxy chain", () => {
  it("looks up cf-connecting-ip, never Cloudflare's own hop", async () => {
    await detectUserState(viaCloudflare("NJ"))

    const asked = mockedProxycheck.mock.calls.map(([ip]) => ip)
    expect(asked).toEqual([CLIENT_IP])
    expect(asked).not.toContain(CLOUDFLARE_HOP)
  })

  it("does NOT block an ordinary buyer when Cloudflare's hop is the flagged address", async () => {
    // The failure the IP fix prevents: a datacenter hop that reads as a proxy.
    proxycheckFlags(CLOUDFLARE_HOP)
    expect(await enforcePaidSubscriptionGeo(viaCloudflare("NJ"))).toBeNull()
  })

  it("reports the client address as rawIp", async () => {
    expect((await detectUserState(viaCloudflare("NJ"))).rawIp).toBe(CLIENT_IP)
  })

  it("still falls back to x-real-ip when no Cloudflare header is present (preview, local)", async () => {
    const geo = await detectUserState(new Headers({ "x-real-ip": "198.51.100.9" }))
    expect(geo.rawIp).toBe("198.51.100.9")
  })
})
