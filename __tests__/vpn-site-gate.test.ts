// @vitest-environment node
/**
 * A VPN, proxy, Tor, data-centre address or iCloud Private Relay must not be a
 * way into the product from a restricted state.
 *
 * Why this file exists. Until 2026-09-24 the only VPN check was in paid checkout.
 * Every other gate reads the location of the IP a VPN replaces, so:
 *
 *   - a Washington user on an Oregon exit read as OR and had the whole product;
 *   - an exit in Canada read as "not US" and skipped every state rule at once;
 *   - Tor (`cf-ipcountry: T1`) normalised to "no country" and passed everything;
 *   - a paid-block user on a VPN could use paid tools they already held.
 *
 * Owner's rule since: over any of those, only PUBLIC pages load, and every API
 * but a short machine/health/sign-out list is refused — wherever the exit is.
 *
 * ⚠ These drive the REAL `middleware()` with Cloudflare-shaped headers, the way
 * paid-api-geo-gate.test.ts does, because the failure worth guarding is never
 * the helper — it is whether the code that uses it is reachable.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }))
vi.mock("@/lib/geo/geoIpFetch", () => ({ fetchIpApi: vi.fn(), fetchProxycheck: vi.fn() }))

import { getToken } from "next-auth/jwt"
import { middleware } from "@/middleware"
import { __resetAnonymizerCache } from "@/lib/geo/anonymizerCache"
import { detectUserState } from "@/lib/geo/detectUserState"
import { fetchIpApi, fetchProxycheck } from "@/lib/geo/geoIpFetch"
import { __resetProxycheckDeniedWarning } from "@/lib/geo/geoIpParse"
import { INTERNAL_HOP_HEADER, signInternalHop } from "@/lib/http/internalHop"

const mockedGetToken = vi.mocked(getToken)
const mockedProxycheck = vi.mocked(fetchProxycheck)
const mockedIpApi = vi.mocked(fetchIpApi)

/** RFC 5737 documentation addresses — never a real user's. */
const VPN_IP = "198.51.100.61"
const HOME_IP = "198.51.100.62"
const RELAY_IP = "198.51.100.63"
const DATACENTRE_IP = "198.51.100.64"
/** Relay egress identified by ASN alone, and by network name alone — each signal must stand on its own. */
const RELAY_BY_ASN_IP = "198.51.100.65"
const RELAY_BY_NAME_IP = "198.51.100.66"
/** Cloudflare WARP egress that proxycheck ALSO lists as a VPN — the relay reason must still win. */
const RELAY_ALSO_LISTED_IP = "198.51.100.67"

const OWNER_ID = "3a7ffd10-b1a5-4a40-8d07-232364596735"
const AUTH_SECRET = "test-nextauth-secret-not-a-real-credential"
const CRON_SECRET = "test-cron-secret-not-a-real-credential-0001"
const PROXYCHECK_KEY = "test-proxycheck-key-not-real"

const ENV_KEYS = ["NEXTAUTH_SECRET", "CRON_SECRET", "PROXYCHECK_API_KEY", "IPAPI_KEY", "CF_ORIGIN_AUTH_SECRET", "CF_ORIGIN_LOCK_MODE"] as const
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

/** What proxycheck.io says about each address, in its v2 `&vpn=1&asn=1` shape. */
const VERDICTS: Record<string, Record<string, unknown>> = {
  [VPN_IP]: { proxy: "yes", type: "VPN", asn: "AS9009", provider: "M247 Europe SRL" },
  [HOME_IP]: { proxy: "no", type: "Residential", asn: "AS7922", provider: "Comcast Cable Communications, LLC" },
  // iCloud Private Relay egress: NOT on a VPN list, caught by its network.
  [RELAY_IP]: { proxy: "no", type: "Business", asn: "AS36183", provider: "Akamai Technologies, Inc." },
  [DATACENTRE_IP]: { proxy: "no", type: "Hosting", asn: "AS8075", provider: "Microsoft Corporation" },
  [RELAY_BY_ASN_IP]: { proxy: "no", type: "Business", asn: "AS54113", provider: "" },
  [RELAY_BY_NAME_IP]: { proxy: "no", type: "Business", provider: "Cloudflare, Inc." },
  [RELAY_ALSO_LISTED_IP]: { proxy: "yes", type: "VPN", asn: "AS13335", provider: "Cloudflare, Inc." },
}

function proxycheckAnswers() {
  mockedProxycheck.mockImplementation(async (ip: string) => ({ status: "ok", [ip]: VERDICTS[ip] }))
}

interface Opts {
  ip?: string
  country?: string
  region?: string | null
  method?: string
  headers?: Record<string, string>
  cookie?: string
}

function request(path: string, { ip = VPN_IP, country = "US", region = "OR", method = "GET", headers = {}, cookie }: Opts = {}) {
  const h: Record<string, string> = { "cf-ipcountry": country, "cf-connecting-ip": ip, ...headers }
  if (region) h["cf-region-code"] = region
  if (cookie) h.cookie = cookie
  return new NextRequest(new URL(`https://www.allfantasy.ai${path}`), { method, headers: h })
}

function isVpnRedirect(res: Response): boolean {
  return (res.headers.get("location") ?? "").includes("/vpn-blocked")
}

async function isVpnRefusal(res: Response): Promise<boolean> {
  if (res.status !== 403) return false
  return (await res.clone().json()).error === "VPN_BLOCKED"
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetAnonymizerCache()
  __resetProxycheckDeniedWarning()
  process.env.NEXTAUTH_SECRET = AUTH_SECRET
  process.env.CRON_SECRET = CRON_SECRET
  process.env.PROXYCHECK_API_KEY = PROXYCHECK_KEY
  delete process.env.IPAPI_KEY
  delete process.env.CF_ORIGIN_AUTH_SECRET
  delete process.env.CF_ORIGIN_LOCK_MODE
  mockedGetToken.mockResolvedValue(null)
  mockedIpApi.mockResolvedValue(null)
  proxycheckAnswers()
})

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe("an anonymized visitor is refused the app, wherever the exit is", () => {
  it("sends a Washington user on an Oregon VPN exit to /vpn-blocked — the case every state gate misses", async () => {
    const res = await middleware(request("/core"))
    expect(isVpnRedirect(res)).toBe(true)
    expect(new URL(res.headers.get("location")!).searchParams.get("from")).toBe("/core")
  })

  it("refuses an exit OUTSIDE the US too — 'not US' skips every state rule, so it must not skip this one", async () => {
    const res = await middleware(request("/core", { country: "CA", region: null }))
    expect(isVpnRedirect(res)).toBe(true)
  })

  it("refuses Tor from Cloudflare's T1 header alone, without spending a vendor call", async () => {
    const res = await middleware(request("/core", { ip: HOME_IP, country: "T1", region: null }))
    expect(isVpnRedirect(res)).toBe(true)
    expect(mockedProxycheck).not.toHaveBeenCalled()
  })

  it("refuses iCloud Private Relay, which no VPN list flags, by its network", async () => {
    const res = await middleware(request("/core", { ip: RELAY_IP }))
    expect(isVpnRedirect(res)).toBe(true)
  })

  it("recognises a relay by its ASN alone, when the vendor gives no network name", async () => {
    expect(isVpnRedirect(await middleware(request("/core", { ip: RELAY_BY_ASN_IP })))).toBe(true)
  })

  it("recognises a relay by its network name alone, when the vendor gives no ASN", async () => {
    expect(isVpnRedirect(await middleware(request("/core", { ip: RELAY_BY_NAME_IP })))).toBe(true)
  })

  it("refuses a data-centre address", async () => {
    const res = await middleware(request("/core", { ip: DATACENTRE_IP }))
    expect(isVpnRedirect(res)).toBe(true)
  })

  it("answers an API with 403 VPN_BLOCKED JSON, never an HTML redirect", async () => {
    const res = await middleware(request("/api/leagues/abc123/matchups", { method: "POST" }))
    expect(await isVpnRefusal(res)).toBe(true)
    expect(res.headers.get("content-type")).toMatch(/application\/json/)
    expect(res.headers.get("location")).toBeNull()
  })

  it("refuses sign-in and sign-up, although /api/auth is exempt from the STATE gates", async () => {
    for (const path of ["/api/auth/callback/credentials", "/api/auth/signin/google", "/api/auth/register"]) {
      const res = await middleware(request(path, { method: "POST" }))
      expect(await isVpnRefusal(res), path).toBe(true)
    }
  })

  it("refuses the sign-in and sign-up PAGES", async () => {
    for (const path of ["/login", "/signup"]) {
      expect(isVpnRedirect(await middleware(request(path))), path).toBe(true)
    }
  })

  it("refuses a paid API over a VPN — the paid tools a VPN used to reach", async () => {
    const res = await middleware(request("/api/user/autocoach", { method: "POST" }))
    expect(await isVpnRefusal(res)).toBe(true)
  })

  it("does not wave through a page just because its path has a dot (player slugs do)", async () => {
    expect(isVpnRedirect(await middleware(request("/player/a.j.-brown")))).toBe(true)
  })
})

describe("an ordinary visitor is untouched", () => {
  it("lets a home connection in Oregon through, page and API", async () => {
    expect(isVpnRedirect(await middleware(request("/core", { ip: HOME_IP })))).toBe(false)
    const api = await middleware(request("/api/leagues/abc123/matchups", { ip: HOME_IP, method: "POST" }))
    expect(api.status).not.toBe(403)
  })

  it("lets a real visitor OUTSIDE the US through — the state rules are about US states", async () => {
    const res = await middleware(request("/core", { ip: HOME_IP, country: "GB", region: "ENG" }))
    expect(isVpnRedirect(res)).toBe(false)
    expect(res.headers.get("location")).toBeNull()
  })

  it("still sends a Washington home connection to /geo-blocked, not /vpn-blocked", async () => {
    const res = await middleware(request("/core", { ip: HOME_IP, region: "WA" }))
    expect(res.headers.get("location")).toContain("/geo-blocked")
  })
})

describe("what stays open over a VPN", () => {
  const PUBLIC_PAGES = [
    "/",
    "/terms",
    "/privacy",
    "/vpn-blocked",
    "/vpn-blocked?from=%2Fcore",
    "/robots.txt",
    "/sitemap.xml",
    "/manifest.webmanifest",
    "/.well-known/assetlinks.json",
  ]
  for (const path of PUBLIC_PAGES) {
    it(`loads ${path}`, async () => {
      expect(isVpnRedirect(await middleware(request(path)))).toBe(false)
    })
  }

  it("spends no vendor call on a public page — crawler traffic would otherwise burn the quota", async () => {
    for (const path of PUBLIC_PAGES) await middleware(request(path))
    expect(mockedProxycheck).not.toHaveBeenCalled()
  })

  const OPEN_APIS: Array<[string, string]> = [
    ["GET", "/api/health"],
    ["GET", "/api/geo/check"],
    ["GET", "/api/af-debug/sha"],
    ["GET", "/api/auth/session"],
    ["GET", "/api/auth/csrf"],
    ["POST", "/api/auth/signout"],
    ["POST", "/api/stripe/webhook"],
    ["POST", "/api/webhooks/resend"],
    ["GET", "/api/v1/players"],
    ["POST", "/api/internal/ingest"],
    // Cancelling must never depend on turning a VPN off.
    ["GET", "/api/subscription/billing-portal"],
  ]
  for (const [method, path] of OPEN_APIS) {
    it(`does not VPN-refuse ${method} ${path}`, async () => {
      expect(await isVpnRefusal(await middleware(request(path, { method })))).toBe(false)
    })
  }
})

describe("callers that are not a person", () => {
  it("lets a machine credential through on an API (a cron from Azure is a data centre)", async () => {
    const res = await middleware(
      request("/api/redraft/score-sync", { ip: DATACENTRE_IP, method: "POST", headers: { authorization: `Bearer ${CRON_SECRET}` } }),
    )
    expect(await isVpnRefusal(res)).toBe(false)
  })

  it("lets a machine credential through on a PAGE (deploy-verify probes /login from a runner)", async () => {
    const res = await middleware(request("/login", { ip: DATACENTRE_IP, headers: { "x-cron-secret": CRON_SECRET } }))
    expect(isVpnRedirect(res)).toBe(false)
  })

  it("does not accept a wrong secret as a machine credential", async () => {
    const res = await middleware(request("/login", { ip: DATACENTRE_IP, headers: { "x-cron-secret": "wrong-secret-value" } }))
    expect(isVpnRedirect(res)).toBe(true)
  })

  describe("our own server calling itself back through Cloudflare (the /api/app and /api/shared proxies)", () => {
    const PATH = "/api/league/list"

    it("lets a signed hop through, although Cloudflare stamps it with Railway's data-centre address", async () => {
      const token = await signInternalHop("GET", PATH, AUTH_SECRET)
      const res = await middleware(request(PATH, { ip: DATACENTRE_IP, headers: { [INTERNAL_HOP_HEADER]: token! } }))
      expect(await isVpnRefusal(res)).toBe(false)
    })

    it("refuses a hop signed for a DIFFERENT path", async () => {
      const token = await signInternalHop("GET", "/api/health", AUTH_SECRET)
      const res = await middleware(request(PATH, { ip: DATACENTRE_IP, headers: { [INTERNAL_HOP_HEADER]: token! } }))
      expect(await isVpnRefusal(res)).toBe(true)
    })

    it("refuses a hop signed with the wrong secret — the header name is public, the key is not", async () => {
      const token = await signInternalHop("GET", PATH, "someone-elses-guess-at-the-secret")
      const res = await middleware(request(PATH, { ip: DATACENTRE_IP, headers: { [INTERNAL_HOP_HEADER]: token! } }))
      expect(await isVpnRefusal(res)).toBe(true)
    })

    it("refuses an expired hop", async () => {
      const token = await signInternalHop("GET", PATH, AUTH_SECRET, Date.now() - 5 * 60_000)
      const res = await middleware(request(PATH, { ip: DATACENTRE_IP, headers: { [INTERNAL_HOP_HEADER]: token! } }))
      expect(await isVpnRefusal(res)).toBe(true)
    })
  })

  describe("crawlers", () => {
    const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
    const ADSBOT = "AdsBot-Google (+http://www.google.com/adsbot.html)"

    it("lets AdsBot load the ad's landing page from a data centre, and spends no lookup on it", async () => {
      const res = await middleware(request("/brackets/leagues/new", { ip: DATACENTRE_IP, headers: { "user-agent": ADSBOT } }))
      expect(isVpnRedirect(res)).toBe(false)
      expect(mockedProxycheck).not.toHaveBeenCalled()
    })

    it("lets Googlebot crawl an app page", async () => {
      const res = await middleware(request("/brackets", { ip: DATACENTRE_IP, headers: { "user-agent": GOOGLEBOT } }))
      expect(isVpnRedirect(res)).toBe(false)
    })

    it("checks a 'crawler' that carries a session cookie — a forged User-Agent buys no more than an anonymous page", async () => {
      const res = await middleware(
        request("/core", { headers: { "user-agent": GOOGLEBOT }, cookie: "__Secure-next-auth.session-token=abc" }),
      )
      expect(isVpnRedirect(res)).toBe(true)
    })

    it("checks a 'crawler' holding a guest-trial cookie", async () => {
      const res = await middleware(request("/core", { headers: { "user-agent": GOOGLEBOT }, cookie: "af_guest_session=abc" }))
      expect(isVpnRedirect(res)).toBe(true)
    })

    it("gives a crawler User-Agent no exemption on the API — sign-in stays shut to a forger", async () => {
      const res = await middleware(
        request("/api/auth/callback/credentials", { method: "POST", headers: { "user-agent": GOOGLEBOT } }),
      )
      expect(await isVpnRefusal(res)).toBe(true)
    })
  })

  it("honours the owner bypass the state gates honour, on a page and on an API", async () => {
    mockedGetToken.mockResolvedValue({ sub: OWNER_ID, username: "owner" } as never)
    expect(isVpnRedirect(await middleware(request("/core")))).toBe(false)
    expect(await isVpnRefusal(await middleware(request("/api/leagues/abc123/matchups", { method: "POST" })))).toBe(false)
  })

  it("does not extend that bypass to any other signed-in user", async () => {
    mockedGetToken.mockResolvedValue({ sub: "some-other-user", username: "someone" } as never)
    expect(isVpnRedirect(await middleware(request("/core")))).toBe(true)
  })
})

describe("it fails open — and says so", () => {
  it("lets a visitor through when proxycheck is unreachable: an outage must not take the product down", async () => {
    mockedProxycheck.mockResolvedValue(null)
    expect(isVpnRedirect(await middleware(request("/core")))).toBe(false)
  })

  it("lets a visitor through on an exhausted quota, and logs the denial once without the key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mockedProxycheck.mockResolvedValue({ status: "denied" })
    expect(isVpnRedirect(await middleware(request("/core")))).toBe(false)
    await middleware(request("/core", { ip: HOME_IP }))
    const denials = warn.mock.calls.filter((c) => String(c[0]).includes("status: denied"))
    expect(denials).toHaveLength(1)
    expect(warn.mock.calls.flat().join(" ")).not.toContain(PROXYCHECK_KEY)
    warn.mockRestore()
  })

  it("still refuses Tor with no vendor key configured at all", async () => {
    delete process.env.PROXYCHECK_API_KEY
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(isVpnRedirect(await middleware(request("/core", { country: "T1", region: null })))).toBe(true)
    expect(isVpnRedirect(await middleware(request("/core")))).toBe(false)
    warn.mockRestore()
  })

  it("uses ipapi's hint when proxycheck has no key", async () => {
    delete process.env.PROXYCHECK_API_KEY
    process.env.IPAPI_KEY = "test-ipapi-key-not-real"
    mockedIpApi.mockResolvedValue({ country_code: "US", region_code: "OR", org: "Example Hosting LLC", asn: "AS64500" })
    expect(isVpnRedirect(await middleware(request("/core")))).toBe(true)
  })
})

describe("one vendor lookup per address", () => {
  it("answers repeat requests from the cache", async () => {
    await middleware(request("/core"))
    await middleware(request("/api/leagues/abc123/matchups", { method: "POST" }))
    await middleware(request("/leagues"))
    expect(mockedProxycheck).toHaveBeenCalledTimes(1)
  })

  it("collapses a page load's parallel requests into one lookup", async () => {
    await Promise.all([
      middleware(request("/core")),
      middleware(request("/api/leagues/a/matchups", { method: "POST" })),
      middleware(request("/api/leagues/b/matchups", { method: "POST" })),
    ])
    expect(mockedProxycheck).toHaveBeenCalledTimes(1)
  })

  it("asks proxycheck about cf-connecting-ip, never Cloudflare's own hop", async () => {
    await middleware(request("/core", { headers: { "x-forwarded-for": "203.0.113.50", "x-real-ip": "203.0.113.50" } }))
    expect(mockedProxycheck).toHaveBeenCalledWith(VPN_IP, PROXYCHECK_KEY, expect.anything())
  })
})

describe("/api/geo/check tells the visitor the same thing the gate decided", () => {
  function geoRequest(ip: string, country = "US") {
    return new Request("https://www.allfantasy.ai/api/geo/check", {
      headers: { "cf-ipcountry": country, "cf-region-code": "OR", "cf-connecting-ip": ip },
    })
  }

  it("reports iCloud Private Relay as a VPN", async () => {
    expect((await detectUserState(geoRequest(RELAY_IP))).isVpnOrProxy).toBe(true)
  })

  it("reports Tor as a VPN", async () => {
    expect((await detectUserState(geoRequest(HOME_IP, "T1"))).isVpnOrProxy).toBe(true)
  })

  it("reports a data centre as a VPN", async () => {
    expect((await detectUserState(geoRequest(DATACENTRE_IP))).isVpnOrProxy).toBe(true)
  })

  it("reports a home connection as clean", async () => {
    expect((await detectUserState(geoRequest(HOME_IP))).isVpnOrProxy).toBe(false)
  })
})

/*
 * Owner report 2026-09-25: VPN app switched off, still sent to /vpn-blocked. Safari's iCloud
 * Private Relay was on (the requests arrived from a Fastly relay address), and a page that opens
 * with "VPN app: disconnect it" did not say so. The gate now tells the page WHY, so it can lead
 * with the one setting to switch off. It changes nothing about who is refused.
 */
describe("the block page is told when the cause is a privacy relay", () => {
  function why(res: Response): string | null {
    return new URL(res.headers.get("location")!).searchParams.get("why")
  }

  for (const [label, ip] of [
    ["an Akamai relay", RELAY_IP],
    ["a relay known only by ASN (Fastly)", RELAY_BY_ASN_IP],
    ["a relay known only by name (Cloudflare)", RELAY_BY_NAME_IP],
  ] as const) {
    it(`says why=relay for ${label}, and still sends the visitor back where they were going`, async () => {
      const res = await middleware(request("/core?tab=trades", { ip }))
      expect(isVpnRedirect(res)).toBe(true)
      expect(why(res)).toBe("relay")
      expect(new URL(res.headers.get("location")!).searchParams.get("from")).toBe("/core?tab=trades")
    })
  }

  it("names the relay even when the vendor ALSO lists the address as a VPN (WARP)", async () => {
    expect(why(await middleware(request("/core", { ip: RELAY_ALSO_LISTED_IP })))).toBe("relay")
  })

  it("says nothing extra for a VPN, a data centre or Tor — the general steps are the right ones there", async () => {
    expect(why(await middleware(request("/core", { ip: VPN_IP })))).toBeNull()
    expect(why(await middleware(request("/core", { ip: DATACENTRE_IP })))).toBeNull()
    expect(why(await middleware(request("/core", { ip: HOME_IP, country: "T1", region: null })))).toBeNull()
  })

  it("points an API refusal at the relay steps too", async () => {
    const relay = await middleware(request("/api/leagues/abc123/matchups", { method: "POST", ip: RELAY_IP }))
    expect(await isVpnRefusal(relay)).toBe(true)
    expect((await relay.json()).redirectTo).toBe("/vpn-blocked?why=relay")

    const vpn = await middleware(request("/api/leagues/abc123/matchups", { method: "POST", ip: VPN_IP }))
    expect((await vpn.json()).redirectTo).toBe("/vpn-blocked")
  })

  it("reads the relay from ipapi's network when proxycheck has no key", async () => {
    delete process.env.PROXYCHECK_API_KEY
    process.env.IPAPI_KEY = "test-ipapi-key-not-real"
    mockedIpApi.mockResolvedValue({ country_code: "US", region_code: "OR", asn: "AS36183", org: "Akamai Technologies, Inc." })
    expect(why(await middleware(request("/core", { ip: RELAY_IP })))).toBe("relay")
  })

  it("keeps the reason on a cached verdict, without a second lookup", async () => {
    await middleware(request("/core", { ip: RELAY_BY_ASN_IP }))
    const again = await middleware(request("/trades", { ip: RELAY_BY_ASN_IP }))
    expect(why(again)).toBe("relay")
    expect(mockedProxycheck).toHaveBeenCalledTimes(1)
  })

  it("still lets the owner through on a relay — the reason never widens or narrows the gate", async () => {
    mockedGetToken.mockResolvedValue({ sub: OWNER_ID, username: "owner" } as never)
    expect(isVpnRedirect(await middleware(request("/core", { ip: RELAY_IP })))).toBe(false)
  })
})
