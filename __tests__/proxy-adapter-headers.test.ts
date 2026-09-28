// @vitest-environment node
/**
 * What the /api/app and /api/shared proxies send when they call our own routes
 * back through the public hostname.
 *
 * 🛑 Why this file exists. #1199 made the proxy forward `cf-connecting-ip`, on
 * the belief that Cloudflare would overwrite it. It does not: Cloudflare refuses
 * any request that arrives carrying that header (403, error 1000 "DNS points to
 * prohibited IP"). Every proxied route in production returned Cloudflare's error
 * page from that deploy until this fix — measured 2026-09-24, and nothing in the
 * suite noticed, because nothing looked at the headers the proxy actually sends.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

import { proxyToExisting } from "@/lib/api/proxy-adapter"
import { INTERNAL_HOP_HEADER, verifyInternalHop } from "@/lib/http/internalHop"

const SECRET = "test-nextauth-secret-not-a-real-credential"
const saved = process.env.NEXTAUTH_SECRET

let sent: { url: string; headers: Headers; method: string } | null = null

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = SECRET
  sent = null
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent = { url, headers: new Headers(init.headers), method: String(init.method) }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (saved === undefined) delete process.env.NEXTAUTH_SECRET
  else process.env.NEXTAUTH_SECRET = saved
})

/** A request as production receives it, through Cloudflare. RFC 5737 addresses only. */
function fromCloudflare(): NextRequest {
  return new NextRequest(new URL("https://www.allfantasy.ai/api/app/leagues"), {
    headers: {
      "cf-connecting-ip": "198.51.100.70",
      "x-forwarded-for": "198.51.100.70, 203.0.113.9",
      "x-real-ip": "203.0.113.9",
      cookie: "__Secure-next-auth.session-token=abc",
      "cf-ipcountry": "US",
      "cf-region-code": "OR",
    },
  })
}

describe("proxyToExisting", () => {
  it("never forwards cf-connecting-ip — Cloudflare refuses a request carrying it", async () => {
    await proxyToExisting(fromCloudflare(), { targetPath: "/api/league/list" })
    expect(sent).not.toBeNull()
    expect(sent!.headers.has("cf-connecting-ip")).toBe(false)
  })

  it("forwards no cf-* header at all — Cloudflare sets those itself", async () => {
    await proxyToExisting(fromCloudflare(), { targetPath: "/api/league/list" })
    const cf = [...sent!.headers.keys()].filter((k) => k.startsWith("cf-"))
    expect(cf).toEqual([])
  })

  it("still forwards the session and the forwarding chain", async () => {
    await proxyToExisting(fromCloudflare(), { targetPath: "/api/league/list" })
    expect(sent!.headers.get("cookie")).toBe("__Secure-next-auth.session-token=abc")
    expect(sent!.headers.get("x-forwarded-for")).toBe("198.51.100.70, 203.0.113.9")
  })

  it("signs the hop for the TARGET path, so the VPN gate accepts Railway's address", async () => {
    await proxyToExisting(fromCloudflare(), { targetPath: "/api/league/list" })
    expect(sent!.headers.has(INTERNAL_HOP_HEADER)).toBe(true)
    expect(await verifyInternalHop(sent!.headers, "GET", "/api/league/list", SECRET)).toBe(true)
    expect(await verifyInternalHop(sent!.headers, "GET", "/api/app/leagues", SECRET)).toBe(false)
  })
})
