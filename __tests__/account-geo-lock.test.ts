// @vitest-environment node
/**
 * The account-level Washington lock (lib/geo/accountGeoLock).
 *
 * Why this file exists. Every other gate reads the location of the REQUEST'S IP,
 * and an undetected residential proxy rewrites exactly that. A Washington
 * resident who signed in once from home and then added such a proxy walked back
 * into the whole product. The owner's rule since 2026-09-24: an account seen in
 * Washington on a normal connection stays locked, from anywhere, until support
 * unlocks it.
 *
 * Three layers, each tested for real rather than through a restatement:
 *   1. the observation and read logic, against a fake store;
 *   2. the NextAuth jwt callback, which must take the lock from the DATABASE and
 *      never from the attacker-controlled `update` payload;
 *   3. middleware.ts, which must enforce it wherever the request appears to be.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }))
vi.mock("@/lib/geo/geoIpFetch", () => ({ fetchIpApi: vi.fn(), fetchProxycheck: vi.fn() }))

import { getToken } from "next-auth/jwt"
import { middleware } from "@/middleware"
import {
  ACCOUNT_CARD_PAID_BLOCK,
  ACCOUNT_FULL_BLOCK,
  accountGeoLockFromLevel,
  __resetAccountGeoLockCache,
  observeAndReadAccountLock,
  type AccountGeoLock,
  type AccountLockStore,
} from "@/lib/geo/accountGeoLock"
import { __resetAnonymizerCache } from "@/lib/geo/anonymizerCache"
import { fetchIpApi, fetchProxycheck } from "@/lib/geo/geoIpFetch"

const mockedGetToken = vi.mocked(getToken)
const mockedProxycheck = vi.mocked(fetchProxycheck)
const mockedIpApi = vi.mocked(fetchIpApi)

/** RFC 5737 documentation addresses — never a real user's. */
const HOME_IP = "198.51.100.81"
const VPN_IP = "198.51.100.82"

const USER = "user-1"
const OWNER_ID = "3a7ffd10-b1a5-4a40-8d07-232364596735"

const ENV_KEYS = ["NEXTAUTH_SECRET", "PROXYCHECK_API_KEY", "IPAPI_KEY", "CF_ORIGIN_AUTH_SECRET", "CF_ORIGIN_LOCK_MODE"] as const
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

function cfHeaders(region: string | null, ip = HOME_IP, country = "US"): Headers {
  const h = new Headers({ "cf-ipcountry": country, "cf-connecting-ip": ip })
  if (region) h.set("cf-region-code", region)
  return h
}

class FakeStore implements AccountLockStore {
  locked = new Map<string, string>()
  failRead = false
  failWrite = false
  reads = 0
  writes = 0
  async read(userId: string): Promise<AccountGeoLock | undefined> {
    this.reads++
    if (this.failRead) return undefined
    return this.locked.has(userId) ? ACCOUNT_FULL_BLOCK : null
  }
  async lock(userId: string, state: string): Promise<void> {
    this.writes++
    if (this.failWrite) throw new Error("db down")
    this.locked.set(userId, state)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetAccountGeoLockCache()
  __resetAnonymizerCache()
  process.env.NEXTAUTH_SECRET = "test-nextauth-secret-not-a-real-credential"
  process.env.PROXYCHECK_API_KEY = "test-proxycheck-key-not-real"
  delete process.env.IPAPI_KEY
  delete process.env.CF_ORIGIN_AUTH_SECRET
  delete process.env.CF_ORIGIN_LOCK_MODE
  mockedIpApi.mockResolvedValue(null)
  mockedProxycheck.mockImplementation(async (ip: string) => ({
    status: "ok",
    [ip]: ip === VPN_IP ? { proxy: "yes", type: "VPN" } : { proxy: "no", type: "Residential" },
  }))
  mockedGetToken.mockResolvedValue(null)
})

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe("observing an account", () => {
  it("locks an account seen in Washington on a normal connection", async () => {
    const store = new FakeStore()
    expect(await observeAndReadAccountLock(USER, cfHeaders("WA"), store)).toBe(ACCOUNT_FULL_BLOCK)
    expect(store.locked.get(USER)).toBe("WA")
  })

  it("does NOT lock on a Washington VPN exit — someone elsewhere must not be locked by where their VPN lands", async () => {
    const store = new FakeStore()
    expect(await observeAndReadAccountLock(USER, cfHeaders("WA", VPN_IP), store)).toBeNull()
    expect(store.writes).toBe(0)
  })

  it("does not lock anyone outside Washington", async () => {
    const store = new FakeStore()
    for (const region of ["OR", "NV", "NJ"]) {
      __resetAccountGeoLockCache()
      expect(await observeAndReadAccountLock(USER, cfHeaders(region), store)).toBeNull()
    }
    expect(store.writes).toBe(0)
  })

  it("stays locked when the account later appears from another state — the residential-proxy case", async () => {
    const store = new FakeStore()
    await observeAndReadAccountLock(USER, cfHeaders("WA"), store)
    __resetAccountGeoLockCache() // a later request, another process: only the database remembers
    expect(await observeAndReadAccountLock(USER, cfHeaders("OR"), store)).toBe(ACCOUNT_FULL_BLOCK)
  })

  it("locks during a VPN-vendor outage — the request is already placed in Washington (documented choice)", async () => {
    mockedProxycheck.mockResolvedValue(null)
    const store = new FakeStore()
    expect(await observeAndReadAccountLock(USER, cfHeaders("WA"), store)).toBe(ACCOUNT_FULL_BLOCK)
  })

  it("keeps the session locked even if the database write fails", async () => {
    const store = new FakeStore()
    store.failWrite = true
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await observeAndReadAccountLock(USER, cfHeaders("WA"), store)).toBe(ACCOUNT_FULL_BLOCK)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it("reports a failed read as undefined — never as 'unlocked'", async () => {
    const store = new FakeStore()
    store.failRead = true
    expect(await observeAndReadAccountLock(USER, cfHeaders("OR"), store)).toBeUndefined()
  })

  it("only reads outside a request (a script or worker has no headers)", async () => {
    const store = new FakeStore()
    store.locked.set(USER, "WA")
    expect(await observeAndReadAccountLock(USER, null, store)).toBe(ACCOUNT_FULL_BLOCK)
    expect(store.writes).toBe(0)
  })

  it("costs one database read per user per cache window, not one per call — this runs on ~2,259 call sites", async () => {
    const store = new FakeStore()
    for (let i = 0; i < 50; i++) await observeAndReadAccountLock(USER, cfHeaders("OR"), store, 1_000)
    expect(store.reads).toBe(1)
    await observeAndReadAccountLock(USER, cfHeaders("OR"), store, 1_000 + 11 * 60_000)
    expect(store.reads).toBe(2)
  })

  it("writes the lock once, not on every Washington request", async () => {
    const store = new FakeStore()
    for (let i = 0; i < 5; i++) await observeAndReadAccountLock(USER, cfHeaders("WA"), store)
    expect(store.writes).toBe(1)
  })
})

describe("the jwt callback takes the lock from the database only", () => {
  it("stamps the lock, and the update payload cannot clear it", async () => {
    vi.resetModules()
    vi.doMock("@/lib/geo/accountGeoLockServer", () => ({ refreshAccountGeoLock: vi.fn(async () => ACCOUNT_FULL_BLOCK) }))
    vi.doMock("@/lib/prisma", () => ({
      prisma: { appUser: { findUnique: vi.fn(async () => ({ username: "someone" })) } },
    }))
    const { authOptions } = await import("@/lib/auth")
    const jwt = authOptions.callbacks!.jwt!

    const signedIn = await jwt({ token: {}, user: { id: USER, email: "a@example.com" } } as never)
    expect(signedIn.geoLock).toBe(ACCOUNT_FULL_BLOCK)

    // The browser posts `update({ geoLock: null })` — an attacker-controlled body.
    const updated = await jwt({
      token: { id: USER, geoLock: ACCOUNT_FULL_BLOCK },
      trigger: "update",
      session: { geoLock: null },
    } as never)
    expect(updated.geoLock).toBe(ACCOUNT_FULL_BLOCK)
    vi.doUnmock("@/lib/geo/accountGeoLockServer")
    vi.doUnmock("@/lib/prisma")
  })

  it("keeps the token's lock when the refresh cannot read, and never throws", async () => {
    vi.resetModules()
    vi.doMock("@/lib/geo/accountGeoLockServer", () => ({
      refreshAccountGeoLock: vi.fn(async () => {
        throw new Error("db down")
      }),
    }))
    vi.doMock("@/lib/prisma", () => ({ prisma: { appUser: { findUnique: vi.fn() } } }))
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    const { authOptions } = await import("@/lib/auth")
    const out = await authOptions.callbacks!.jwt!({ token: { id: USER, geoLock: ACCOUNT_FULL_BLOCK } } as never)
    expect(out.geoLock).toBe(ACCOUNT_FULL_BLOCK)
    err.mockRestore()
    vi.doUnmock("@/lib/geo/accountGeoLockServer")
    vi.doUnmock("@/lib/prisma")
  })
})

describe("middleware enforces the lock wherever the request appears to be", () => {
  const SESSION_COOKIE = "__Secure-next-auth.session-token=abc"

  function req(path: string, { method = "GET", region = "OR", cookie = SESSION_COOKIE, headers = {} as Record<string, string> } = {}) {
    const h: Record<string, string> = { "cf-ipcountry": "US", "cf-region-code": region, "cf-connecting-ip": HOME_IP, ...headers }
    if (cookie) h.cookie = cookie
    return new NextRequest(new URL(`https://www.allfantasy.ai${path}`), { method, headers: h })
  }

  function lockedToken(sub = USER) {
    mockedGetToken.mockResolvedValue({ sub, username: "someone", geoLock: ACCOUNT_FULL_BLOCK } as never)
  }

  it("sends a locked account in Oregon to /geo-blocked?reason=account", async () => {
    lockedToken()
    const res = await middleware(req("/core"))
    const loc = new URL(res.headers.get("location")!)
    expect(loc.pathname).toBe("/geo-blocked")
    expect(loc.searchParams.get("reason")).toBe("account")
  })

  it("locks the homepage too — the Washington rule covers the whole product", async () => {
    lockedToken()
    expect((await middleware(req("/"))).headers.get("location")).toContain("/geo-blocked")
  })

  it("answers a locked account's API call with 403 GEO_BLOCKED, reason account", async () => {
    lockedToken()
    const res = await middleware(req("/api/leagues/abc/matchups", { method: "POST" }))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: "GEO_BLOCKED", reason: "account" })
  })

  for (const [method, path] of [
    ["GET", "/terms"],
    ["GET", "/geo-blocked?reason=account"],
    ["GET", "/api/auth/session"],
    ["POST", "/api/auth/signout"],
    ["GET", "/api/subscription/billing-portal"],
  ] as const) {
    it(`still lets a locked account reach ${method} ${path}`, async () => {
      lockedToken()
      const res = await middleware(req(path, { method }))
      expect(res.status).not.toBe(403)
      expect(res.headers.get("location") ?? "").not.toContain("/geo-blocked")
    })
  }

  it("leaves an unlocked account alone", async () => {
    mockedGetToken.mockResolvedValue({ sub: USER, username: "someone", geoLock: null } as never)
    expect((await middleware(req("/core"))).headers.get("location")).toBeNull()
    expect((await middleware(req("/api/leagues/abc/matchups", { method: "POST" }))).status).not.toBe(403)
  })

  it("does not decode a session on an API call that carries no session cookie", async () => {
    await middleware(req("/api/leagues/abc/matchups", { method: "POST", cookie: "" }))
    expect(mockedGetToken).not.toHaveBeenCalled()
  })

  it("honours the owner bypass", async () => {
    lockedToken(OWNER_ID)
    expect((await middleware(req("/core"))).headers.get("location")).toBeNull()
  })
})

/*
 * The CARD lock (2026-09-25): a purchase with a restricted state's card billing
 * address was refunded, and the account is kept off PAID surfaces only — from
 * anywhere. Free features stay open, which is the whole difference from the
 * Washington lock above.
 */
describe("the card lock keeps an account off paid surfaces only", () => {
  const SESSION_COOKIE = "__Secure-next-auth.session-token=abc"

  function req(path: string, { method = "GET", region = "OR" } = {}) {
    return new NextRequest(new URL(`https://www.allfantasy.ai${path}`), {
      method,
      headers: { "cf-ipcountry": "US", "cf-region-code": region, "cf-connecting-ip": HOME_IP, cookie: SESSION_COOKIE },
    })
  }

  function cardLockedToken(sub = USER) {
    mockedGetToken.mockResolvedValue({ sub, username: "someone", geoLock: ACCOUNT_CARD_PAID_BLOCK } as never)
  }

  it("answers a paid API from Oregon with 451, reason billing_address", async () => {
    cardLockedToken()
    const res = await middleware(req("/api/monetization/checkout/subscription", { method: "POST" }))
    expect(res.status).toBe(451)
    expect(await res.json()).toMatchObject({
      error: "PAID_GEO_BLOCKED",
      reason: "billing_address",
      redirectTo: "/paid-restricted?reason=billing",
    })
  })

  it("sends a paid page to /paid-restricted?reason=billing", async () => {
    cardLockedToken()
    const loc = new URL((await middleware(req("/league/abc/dispersal-draft"))).headers.get("location")!)
    expect(loc.pathname).toBe("/paid-restricted")
    expect(loc.searchParams.get("reason")).toBe("billing")
  })

  it("leaves free pages and free APIs open", async () => {
    cardLockedToken()
    expect((await middleware(req("/core"))).headers.get("location")).toBeNull()
    expect((await middleware(req("/"))).headers.get("location")).toBeNull()
    const api = await middleware(req("/api/leagues/abc/matchups", { method: "POST" }))
    expect(api.status).not.toBe(451)
    expect(api.status).not.toBe(403)
  })

  it("still lets the account reach the billing portal, to cancel anything it already has", async () => {
    cardLockedToken()
    expect((await middleware(req("/api/subscription/billing-portal", { method: "POST" }))).status).not.toBe(451)
  })

  it("honours the owner bypass", async () => {
    cardLockedToken(OWNER_ID)
    expect((await middleware(req("/api/monetization/checkout/subscription", { method: "POST" }))).status).not.toBe(451)
  })
})

describe("stored levels", () => {
  it("reads the signup route's `paid_block` as NO lock — the owner chose the card over that signal", () => {
    expect(accountGeoLockFromLevel("paid_block")).toBeNull()
    expect(accountGeoLockFromLevel(null)).toBeNull()
    expect(accountGeoLockFromLevel("card_paid_block")).toBe(ACCOUNT_CARD_PAID_BLOCK)
    expect(accountGeoLockFromLevel("full_block")).toBe(ACCOUNT_FULL_BLOCK)
  })

  it("escalates a card-locked account to the full lock when it is seen in Washington", async () => {
    const lock = vi.fn(async () => {})
    const store: AccountLockStore = { read: async () => ACCOUNT_CARD_PAID_BLOCK, lock }
    await expect(observeAndReadAccountLock(USER, cfHeaders("WA"), store)).resolves.toBe(ACCOUNT_FULL_BLOCK)
    expect(lock).toHaveBeenCalledWith(USER, "WA")
  })
})
