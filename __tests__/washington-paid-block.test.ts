// @vitest-environment node
/**
 * Washington is PAID-block, not full-block — owner's decision, November 2026, on counsel's
 * confirmation that free, prize-less season-long fantasy is lawful there.
 *
 * Pins the REAL policy (no stand-in): the free product is open from Washington, paid features
 * are not, and accounts locked under the old rule get the free product back. The dormant
 * full-block machinery is still tested in account-geo-lock and wa-api-full-block, with a
 * stand-in state.
 *
 * All addresses are RFC 5737 documentation addresses. This repo is public.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }))
vi.mock("@/lib/geo/geoIpFetch", () => ({ fetchIpApi: vi.fn(async () => null), fetchProxycheck: vi.fn(async () => null) }))
vi.mock("@/lib/geo/privateRelayEdge", () => ({ getRelayRangeSetEdge: vi.fn(async () => null) }))
vi.mock("@/lib/geo/privateRelayStore", () => ({ getRelayRangeSetNode: vi.fn(async () => null) }))

import { getToken } from "next-auth/jwt"
import { middleware } from "@/middleware"
import {
  ACCOUNT_CARD_PAID_BLOCK,
  __resetAccountGeoLockCache,
  accountGeoLockFromLevel,
  observeAndReadAccountLock,
  type AccountLockStore,
} from "@/lib/geo/accountGeoLock"
import { getRestrictionLevel, hasFullBlockStates, isFullyBlocked, isPaidBlocked } from "@/lib/geo/restrictedStates"

const mockedGetToken = vi.mocked(getToken)

function fromWA(path: string, method = "GET", extra: Record<string, string> = {}) {
  return new NextRequest(new URL(`https://www.allfantasy.ai${path}`), {
    method,
    headers: { "cf-ipcountry": "US", "cf-region-code": "WA", "cf-connecting-ip": "198.51.100.71", ...extra },
  })
}

function fromNJWithSession(path: string, method = "GET") {
  return new NextRequest(new URL(`https://www.allfantasy.ai${path}`), {
    method,
    headers: {
      "cf-ipcountry": "US",
      "cf-region-code": "NJ",
      "cf-connecting-ip": "198.51.100.72",
      cookie: "__Secure-next-auth.session-token=test-session",
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetAccountGeoLockCache()
  process.env.NEXTAUTH_SECRET = "test-nextauth-secret-not-a-real-credential"
  mockedGetToken.mockResolvedValue(null)
})

describe("the rule", () => {
  it("Washington is paid-block, and no state is full-block", () => {
    expect(getRestrictionLevel("WA")).toBe("paid_block")
    expect(isPaidBlocked("WA")).toBe(true)
    expect(isFullyBlocked("WA")).toBe(false)
    expect(hasFullBlockStates()).toBe(false)
  })
})

describe("a person in Washington", () => {
  it("reaches the app's pages — no /geo-blocked redirect", async () => {
    const res = await middleware(fromWA("/core"))
    expect(res.headers.get("location") ?? "").not.toContain("/geo-blocked")
  })

  for (const path of ["/api/leagues", "/api/core/home", "/api/instant/player-search?q=al"]) {
    it(`uses the free API: ${path}`, async () => {
      const res = await middleware(fromWA(path))
      expect([403, 451]).not.toContain(res.status)
    })
  }

  it("is refused on a paid API route, with free play left open", async () => {
    const res = await middleware(fromWA("/api/leagues/import"))
    expect(res.status).toBe(451)
    expect(await res.json()).toMatchObject({ error: "PAID_GEO_BLOCKED", stateCode: "WA", allowFree: true })
  })
})

describe("accounts locked under the old Washington rule", () => {
  it("a stored `full_block` reads as the card lock (paid only)", () => {
    expect(accountGeoLockFromLevel("full_block")).toBe(ACCOUNT_CARD_PAID_BLOCK)
  })

  it("a token still carrying `full_block` gets the free product, from anywhere", async () => {
    mockedGetToken.mockResolvedValue({ sub: "user-wa-legacy", geoLock: "full_block" } as never)
    const page = await middleware(fromNJWithSession("/core"))
    expect(page.headers.get("location") ?? "").not.toContain("/geo-blocked")
    const free = await middleware(fromNJWithSession("/api/leagues"))
    expect([403, 451]).not.toContain(free.status)
  })

  it("…and stays off paid features", async () => {
    mockedGetToken.mockResolvedValue({ sub: "user-wa-legacy", geoLock: "full_block" } as never)
    const paid = await middleware(fromNJWithSession("/api/leagues/import", "POST"))
    expect(paid.status).toBe(451)
    expect((await paid.json()).error).toBe("PAID_GEO_BLOCKED")
  })

  it("a Washington sighting no longer creates a lock", async () => {
    const lock = vi.fn(async () => {})
    const store: AccountLockStore = { read: vi.fn(async () => null), lock }
    const headers = new Headers({ "cf-ipcountry": "US", "cf-region-code": "WA", "cf-connecting-ip": "198.51.100.73" })
    expect(await observeAndReadAccountLock("user-new", headers, store)).toBeNull()
    expect(lock).not.toHaveBeenCalled()
  })
})
