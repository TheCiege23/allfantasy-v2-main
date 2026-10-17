// @vitest-environment node
/**
 * The iOS app (ios-app/, a Capacitor WebView over allfantasy.ai) must pass App
 * Store review. Three things in the WEBSITE decide that, and each is driven here
 * through the REAL middleware:
 *
 *  1. Guideline 3.1.1 — nothing is sold inside the app. A request carrying the
 *     app's User-Agent marker is redirected off purchase pages and refused on
 *     checkout APIs. The same request without the marker is untouched.
 *  2. App Review signs in from Apple's corporate network (17.0.0.0/8). A vendor
 *     that calls that "hosting" would trip the VPN gate and the reviewer would
 *     see /vpn-blocked. Apple's network is not treated as an anonymizer…
 *  3. …but it gets NOTHING else: a Relay address Apple itself lists still
 *     follows the Relay rule, and Washington is still Washington.
 *
 * Every "passes" assertion has a positive control beside it — the same request
 * that DOES trip the gate — so a gate that stopped firing altogether cannot read
 * as the exemption working.
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

import { getToken } from "next-auth/jwt"
import { middleware } from "@/middleware"
import { fetchIpApi, fetchProxycheck } from "@/lib/geo/geoIpFetch"
import { getRelayRangeSetEdge } from "@/lib/geo/privateRelayEdge"
import { getRelayRangeSetNode } from "@/lib/geo/privateRelayStore"
import { parseEgressGeofeed } from "@/lib/geo/privateRelayRanges"
import { __resetAnonymizerCache } from "@/lib/geo/anonymizerCache"
import { detectUserState } from "@/lib/geo/detectUserState"
import { isAppleCorporateNetwork } from "@/lib/geo/appleNetwork"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  IOS_APP_HTML_FLAG_SCRIPT,
  IOS_APP_IAP_PAGE_PREFIXES,
  IOS_APP_IAP_UA_MARKER,
  IOS_APP_PLANS_PATH,
  IOS_APP_UA_MARKER,
  isIosAppClosedPage,
  isIosAppIapUserAgent,
  isIosAppPurchaseApi,
  isIosAppPurchasePage,
  isIosAppUserAgent,
} from "@/lib/platform/iosApp"

/** A 1.0 build: no StoreKit bridge, sells nothing. */
const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AllFantasyiOS/1.0"
/** A build with the StoreKit bridge (ios-app/capacitor.config.json). */
const IOS_IAP_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AllFantasyiOS/1.1 AFIAP/1"
const SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1"

/** Apple corporate (AS714) — App Review. */
const APPLE_REVIEW_IP = "17.58.100.12"
/** Apple's own range, but listed in Apple's Relay feed as California. */
const APPLE_LISTED_RELAY_CA = "17.99.0.5"
/** RFC 5737 documentation address — an ordinary commercial VPN. */
const COMMERCIAL_VPN = "198.51.100.70"
const RESIDENTIAL = "198.51.100.99"

const SET = parseEgressGeofeed(
  ["# prefix,country,region,city,postal", "17.99.0.0/24,US,US-CA,Los Angeles,"].join("\n"),
  new Date("2026-09-28T00:00:00Z"),
).set

// The worst case for the exemption: the vendor calls Apple's network a VPN.
const VPN_VERDICT = { proxy: "yes", type: "VPN", asn: "AS714", provider: "Apple Inc." }
const VERDICTS: Record<string, Record<string, unknown>> = {
  [APPLE_REVIEW_IP]: VPN_VERDICT,
  [APPLE_LISTED_RELAY_CA]: VPN_VERDICT,
  [COMMERCIAL_VPN]: { proxy: "yes", type: "VPN", asn: "AS9009", provider: "M247 Europe SRL" },
  [RESIDENTIAL]: { proxy: "no", type: "Residential", asn: "AS7922", provider: "Comcast" },
}

const ENV_KEYS = ["NEXTAUTH_SECRET", "PROXYCHECK_API_KEY", "IPAPI_KEY", "CF_ORIGIN_AUTH_SECRET", "CF_ORIGIN_LOCK_MODE"] as const
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

const mockedProxycheck = vi.mocked(fetchProxycheck)

beforeEach(() => {
  vi.clearAllMocks()
  __resetAnonymizerCache()
  process.env.NEXTAUTH_SECRET = "test-nextauth-secret-not-a-real-credential"
  process.env.PROXYCHECK_API_KEY = "test-proxycheck-key-not-real"
  delete process.env.IPAPI_KEY
  delete process.env.CF_ORIGIN_AUTH_SECRET
  delete process.env.CF_ORIGIN_LOCK_MODE
  vi.mocked(getToken).mockResolvedValue(null)
  vi.mocked(fetchIpApi).mockResolvedValue(null)
  mockedProxycheck.mockImplementation(async (ip: string) => ({ status: "ok", [ip]: VERDICTS[ip] }))
  vi.mocked(getRelayRangeSetEdge).mockResolvedValue(SET)
  vi.mocked(getRelayRangeSetNode).mockResolvedValue(SET)
})

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

function request(path: string, opts: { ua?: string; ip?: string; region?: string; method?: string } = {}) {
  return new NextRequest(new URL(`https://www.allfantasy.ai${path}`), {
    method: opts.method ?? "GET",
    headers: {
      "cf-ipcountry": "US",
      "cf-region-code": opts.region ?? "CA",
      "cf-connecting-ip": opts.ip ?? RESIDENTIAL,
      "user-agent": opts.ua ?? SAFARI_UA,
    },
  })
}

const location = (res: Response) => {
  const raw = res.headers.get("location")
  return raw ? new URL(raw) : null
}

describe("iOS app detection and path lists", () => {
  it("recognises the marker Capacitor appends, and nothing else", () => {
    expect(isIosAppUserAgent(IOS_UA)).toBe(true)
    expect(isIosAppUserAgent(SAFARI_UA)).toBe(false)
    expect(isIosAppUserAgent(null)).toBe(false)
    expect(IOS_UA).toContain(IOS_APP_UA_MARKER)
  })

  it("matches purchase pages on a segment boundary", () => {
    for (const p of ["/upgrade", "/upgrade/x", "/pricing", "/commissioner-upgrade", "/tokens", "/donate", "/donate/success", "/support", "/survivor/abc/exile/tokens"]) {
      expect(isIosAppPurchasePage(p), p).toBe(true)
    }
    for (const p of ["/core", "/contact", "/supporters", "/upgraded-feature", "/survivor/abc", IOS_APP_PLANS_PATH]) {
      expect(isIosAppPurchasePage(p), p).toBe(false)
    }
  })

  it("matches purchase APIs, not their read-only neighbours", () => {
    for (const p of [
      "/api/monetization/checkout/subscription",
      "/api/monetization/checkout/tokens",
      "/api/stripe/create-checkout-session",
      "/api/subscription/billing-portal",
      "/api/donate",
      "/api/bracket/donate",
      "/api/marketplace/purchase",
      "/api/leagues/abc/finance/entry-checkout",
    ]) {
      expect(isIosAppPurchaseApi(p), p).toBe(true)
    }
    for (const p of ["/api/tokens/balance", "/api/monetization/post-purchase-sync", "/api/leagues/abc/finance"]) {
      expect(isIosAppPurchaseApi(p), p).toBe(false)
    }
  })
})

describe("guideline 3.1.1 — nothing is sold inside the app", () => {
  it("redirects a purchase page to the plans notice", async () => {
    const res = await middleware(request("/upgrade?plan=pro", { ua: IOS_UA }))
    expect(res.status).toBe(307)
    expect(location(res)?.pathname).toBe(IOS_APP_PLANS_PATH)
  })

  it("control: the same page in Safari is not sent there", async () => {
    const res = await middleware(request("/upgrade?plan=pro"))
    expect(location(res)?.pathname).not.toBe(IOS_APP_PLANS_PATH)
  })

  it("refuses a checkout API with JSON, never HTML", async () => {
    const res = await middleware(request("/api/monetization/checkout/subscription", { ua: IOS_UA, method: "POST" }))
    expect(res.status).toBe(403)
    expect(res.headers.get("content-type")).toMatch(/application\/json/)
    expect((await res.json()).error).toBe("not_available_in_ios_app")
  })

  it("control: the same checkout call from Safari is not refused for being in the app", async () => {
    const res = await middleware(request("/api/monetization/checkout/subscription", { method: "POST" }))
    if (res.status === 403) expect((await res.json()).error).not.toBe("not_available_in_ios_app")
  })

  it("leaves the rest of the app alone", async () => {
    const res = await middleware(request("/core", { ua: IOS_UA }))
    expect(location(res)?.pathname ?? null).not.toBe(IOS_APP_PLANS_PATH)
  })
})

describe("guideline 3.1.1 — an IAP build sells plans and tokens through Apple only", () => {
  it("recognises the IAP marker only alongside the app marker", () => {
    expect(isIosAppIapUserAgent(IOS_IAP_UA)).toBe(true)
    expect(isIosAppIapUserAgent(IOS_UA)).toBe(false)
    expect(isIosAppIapUserAgent(`${SAFARI_UA} ${IOS_APP_IAP_UA_MARKER}/1`)).toBe(false)
    expect(isIosAppIapUserAgent(null)).toBe(false)
  })

  it("the Apple-sellable pages are a subset of the purchase pages", () => {
    for (const p of IOS_APP_IAP_PAGE_PREFIXES) expect(isIosAppPurchasePage(p), p).toBe(true)
  })

  it("opens the plan and token pages to an IAP build", async () => {
    for (const p of ["/upgrade?plan=pro", "/pricing", "/commissioner-upgrade", "/tokens"]) {
      const res = await middleware(request(p, { ua: IOS_IAP_UA }))
      expect(location(res)?.pathname ?? null, p).not.toBe(IOS_APP_PLANS_PATH)
    }
  })

  it("control: the same pages still redirect a 1.0 build with no StoreKit bridge", async () => {
    for (const p of ["/upgrade?plan=pro", "/pricing", "/commissioner-upgrade", "/tokens"]) {
      const res = await middleware(request(p, { ua: IOS_UA }))
      expect(res.status, p).toBe(307)
      expect(location(res)?.pathname, p).toBe(IOS_APP_PLANS_PATH)
    }
  })

  it("keeps donations and the Survivor exile shop closed to an IAP build", async () => {
    for (const p of ["/donate", "/support", "/survivor/abc/exile/tokens"]) {
      expect(isIosAppClosedPage(p, IOS_IAP_UA), p).toBe(true)
      const res = await middleware(request(p, { ua: IOS_IAP_UA }))
      expect(res.status, p).toBe(307)
      expect(location(res)?.pathname, p).toBe(IOS_APP_PLANS_PATH)
    }
  })

  it("still refuses Stripe checkout and the billing portal from an IAP build", async () => {
    for (const p of [
      "/api/monetization/checkout/subscription",
      "/api/monetization/checkout/tokens",
      "/api/subscription/billing-portal",
    ]) {
      const res = await middleware(request(p, { ua: IOS_IAP_UA, method: "POST" }))
      expect(res.status, p).toBe(403)
      expect((await res.json()).error, p).toBe("not_available_in_ios_app")
    }
  })

  it("leaves the Apple purchase APIs open to an IAP build", async () => {
    for (const p of ["/api/monetization/apple/products", "/api/monetization/apple/transactions"]) {
      expect(isIosAppPurchaseApi(p), p).toBe(false)
      const res = await middleware(request(p, { ua: IOS_IAP_UA, method: p.endsWith("products") ? "GET" : "POST" }))
      if (res.status === 403) expect((await res.json()).error, p).not.toBe("not_available_in_ios_app")
    }
  })

  it("the pre-paint flag script sets data-ios-iap only for an IAP build", () => {
    const run = (ua: string) => {
      const attrs: Record<string, string> = {}
      const fn = new Function("navigator", "document", IOS_APP_HTML_FLAG_SCRIPT)
      fn({ userAgent: ua }, { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } })
      return attrs
    }
    expect(run(IOS_IAP_UA)).toEqual({ "data-ios-app": "1", "data-ios-iap": "1" })
    expect(run(IOS_UA)).toEqual({ "data-ios-app": "1" })
    expect(run(SAFARI_UA)).toEqual({})
  })

  it("ships the IAP marker in the Capacitor config, so builds actually send it", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "ios-app/capacitor.config.json"), "utf8"))
    expect(isIosAppIapUserAgent(`Mozilla/5.0 (iPhone) ${config.ios.appendUserAgent}`)).toBe(true)
  })
})

describe("App Review's network is not treated as a VPN", () => {
  it("recognises Apple's ranges and nothing near them", () => {
    for (const ip of ["17.0.0.1", "17.255.255.255", "::ffff:17.58.100.12", "2620:149:a44::1", "2620:0149::5", "[2620:149::1]"]) {
      expect(isAppleCorporateNetwork(ip), ip).toBe(true)
    }
    for (const ip of ["170.1.1.1", "117.1.1.1", "18.0.0.1", "2620::149", "2620:14a::1", "2621:149::1", "", "not-an-ip"]) {
      expect(isAppleCorporateNetwork(ip), ip).toBe(false)
    }
  })

  it("control: a commercial VPN is still sent to /vpn-blocked", async () => {
    const res = await middleware(request("/login", { ip: COMMERCIAL_VPN }))
    expect(location(res)?.pathname).toBe("/vpn-blocked")
  })

  it("lets App Review reach sign-in even when the vendor calls Apple a VPN", async () => {
    const res = await middleware(request("/login", { ip: APPLE_REVIEW_IP }))
    expect(location(res)?.pathname ?? null).not.toBe("/vpn-blocked")
    expect(mockedProxycheck).not.toHaveBeenCalled()
  })

  it("lets App Review's sign-in API through", async () => {
    const res = await middleware(request("/api/auth/callback/credentials", { ip: APPLE_REVIEW_IP, method: "POST" }))
    expect(res.status).not.toBe(403)
  })

  it("an Apple address that Apple lists as Relay still follows the Relay rule (California is refused)", async () => {
    const res = await middleware(request("/login", { ip: APPLE_LISTED_RELAY_CA }))
    expect(location(res)?.pathname).toBe("/vpn-blocked")
  })

  it("Washington is still Washington", async () => {
    const control = await middleware(request("/core", { ip: RESIDENTIAL, region: "WA" }))
    const apple = await middleware(request("/core", { ip: APPLE_REVIEW_IP, region: "WA" }))
    expect(location(control)?.pathname).toBeTruthy()
    expect(location(apple)?.pathname).toBe(location(control)?.pathname)
  })

  it("detectUserState (signup, checkout) agrees with the middleware", async () => {
    const headers = (ip: string) => new Headers({ "cf-ipcountry": "US", "cf-region-code": "CA", "cf-connecting-ip": ip })
    expect((await detectUserState(headers(APPLE_REVIEW_IP))).isVpnOrProxy).toBe(false)
    expect((await detectUserState(headers(COMMERCIAL_VPN))).isVpnOrProxy).toBe(true)
  })
})
