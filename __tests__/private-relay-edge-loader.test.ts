// @vitest-environment node
/**
 * The middleware's copy of the Private Relay ranges (lib/geo/privateRelayEdge).
 * Every failure must yield `null` — which keeps relay users blocked, the safe
 * direction — and a success must be reused rather than refetched per request.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { __resetRelayRangeEdgeCache, getRelayRangeSetEdge } from "@/lib/geo/privateRelayEdge"
import { parseEgressGeofeed } from "@/lib/geo/privateRelayRanges"
import { INTERNAL_HOP_HEADER, verifyInternalHop } from "@/lib/http/internalHop"

const SET = parseEgressGeofeed("198.51.100.8/30,US,US-NY,New York,", new Date("2026-09-28T00:00:00Z")).set
const ORIGIN = "https://www.allfantasy.ai"
const SECRET = "test-nextauth-secret-not-a-real-credential"

let saved: string | undefined
beforeEach(() => {
  __resetRelayRangeEdgeCache()
  saved = process.env.NEXTAUTH_SECRET
  process.env.NEXTAUTH_SECRET = SECRET
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  if (saved === undefined) delete process.env.NEXTAUTH_SECRET
  else process.env.NEXTAUTH_SECRET = saved
})

describe("getRelayRangeSetEdge", () => {
  it("fetches our own route with a valid internal-hop signature, and caches the answer", async () => {
    const fetchMock = vi.fn(async (url: URL, init: RequestInit) => {
      expect(url.toString()).toBe(`${ORIGIN}/api/geo/private-relay-ranges`)
      const headers = new Headers(init.headers)
      expect(await verifyInternalHop(headers, "GET", "/api/geo/private-relay-ranges", SECRET)).toBe(true)
      return new Response(JSON.stringify(SET), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    expect(await getRelayRangeSetEdge(ORIGIN)).toEqual(SET)
    expect(await getRelayRangeSetEdge(ORIGIN)).toEqual(SET)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(new Headers(fetchMock.mock.calls[0]![1].headers).has(INTERNAL_HOP_HEADER)).toBe(true)
  })

  it("yields null on a 404 (nothing ingested yet), and says so once", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })))
    expect(await getRelayRangeSetEdge(ORIGIN)).toBeNull()
    expect(console.warn).toHaveBeenCalledTimes(1)
  })

  it("yields null on a malformed body or a network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ v: 99 }), { status: 200 })))
    expect(await getRelayRangeSetEdge(ORIGIN)).toBeNull()
    __resetRelayRangeEdgeCache()
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down") }))
    expect(await getRelayRangeSetEdge(ORIGIN)).toBeNull()
  })
})
