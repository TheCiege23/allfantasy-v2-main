// @vitest-environment node
/**
 * A VPN switched on mid-session: the open page's API calls start coming back
 * `403 VPN_BLOCKED`, and the watcher must send the person to the block page
 * the SERVER picks — but only when the server would redirect this page, since
 * the homepage and legal pages stay open over a VPN and still call APIs.
 */

import { describe, expect, it, vi } from "vitest"

import { installGeoRefusalWatcher, isPageLevelGeoRefusal, sameOriginApiUrl } from "@/lib/geo/geoRefusalWatcher"

const ORIGIN = "https://www.allfantasy.ai"

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

const VPN_403 = () => json(403, { error: "VPN_BLOCKED", redirectTo: "/vpn-blocked" })

/**
 * A fake window. `api` answers /api/* calls; `page` answers the probe of the
 * current page (the only non-API fetch the watcher makes).
 */
function fakeWindow(pathname: string, api: () => Response, page: () => Response | { type: string; status: number }) {
  const assign = vi.fn()
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const win = {
    location: { href: `${ORIGIN}${pathname}`, pathname, origin: ORIGIN, assign } as unknown as Location,
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      calls.push({ url, init })
      return (new URL(url, ORIGIN).pathname.startsWith("/api/") ? api() : page()) as Response
    }) as unknown as typeof fetch,
  }
  installGeoRefusalWatcher(win)
  const probes = () => calls.filter((c) => c.init?.redirect === "manual")
  return { win, assign, probes }
}

/** Let the watcher's un-awaited inspection finish. */
const settle = () => new Promise((r) => setTimeout(r, 0))

describe("isPageLevelGeoRefusal", () => {
  it("counts the middleware's 403 VPN and Washington refusals", () => {
    expect(isPageLevelGeoRefusal(403, { error: "VPN_BLOCKED" })).toBe(true)
    expect(isPageLevelGeoRefusal(403, { error: "GEO_BLOCKED", reason: "account" })).toBe(true)
    expect(isPageLevelGeoRefusal(403, { error: "GEO_BLOCKED", stateCode: "WA" })).toBe(true)
  })

  it("ignores feature-level refusals, which their callers already explain", () => {
    expect(isPageLevelGeoRefusal(451, { error: "PAID_GEO_BLOCKED" })).toBe(false)
    // checkout's own VPN refusal is a 451 and names one feature, not the page
    expect(isPageLevelGeoRefusal(451, { error: "VPN_BLOCKED" })).toBe(false)
    expect(isPageLevelGeoRefusal(403, { error: "Forbidden" })).toBe(false)
    expect(isPageLevelGeoRefusal(403, null)).toBe(false)
  })
})

describe("sameOriginApiUrl", () => {
  const page = `${ORIGIN}/core`
  it("accepts our own API, relative or absolute", () => {
    expect(sameOriginApiUrl("/api/app/leagues", page)?.pathname).toBe("/api/app/leagues")
    expect(sameOriginApiUrl(new URL(`${ORIGIN}/api/x`), page)?.pathname).toBe("/api/x")
    expect(sameOriginApiUrl(new Request(`${ORIGIN}/api/y`), page)?.pathname).toBe("/api/y")
  })
  it("rejects other origins and non-API paths", () => {
    // A neutral host: a real provider URL here trips the DB-first guard as a live call.
    expect(sameOriginApiUrl("https://example.com/api/v1/x", page)).toBeNull()
    expect(sameOriginApiUrl("/apiary", page)).toBeNull()
    expect(sameOriginApiUrl("/core", page)).toBeNull()
  })
})

describe("installGeoRefusalWatcher", () => {
  it("navigates when the server would redirect the open page", async () => {
    const { win, assign } = fakeWindow("/core", VPN_403, () => new Response(null, { status: 307, headers: { location: "/vpn-blocked" } }))
    const res = await win.fetch("/api/app/leagues")
    // the caller still gets its own unread 403
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe("VPN_BLOCKED")
    await settle()
    // a full navigation to the SAME url: the middleware chooses the block page and its `from`
    expect(assign).toHaveBeenCalledWith(`${ORIGIN}/core`)
  })

  it("treats a browser's opaque manual redirect as a redirect", async () => {
    const { win, assign } = fakeWindow("/core", VPN_403, () => ({ type: "opaqueredirect", status: 0 }))
    await win.fetch("/api/app/leagues")
    await settle()
    expect(assign).toHaveBeenCalledTimes(1)
  })

  it("leaves a public page alone, and probes it only once", async () => {
    const { win, assign, probes } = fakeWindow("/", VPN_403, () => new Response("<html></html>", { status: 200 }))
    await win.fetch("/api/landing/stats")
    await settle()
    await win.fetch("/api/landing/stats")
    await settle()
    expect(assign).not.toHaveBeenCalled()
    expect(probes()).toHaveLength(1)
  })

  it("does nothing for feature-level refusals or other 403s", async () => {
    for (const api of [
      () => json(451, { error: "PAID_GEO_BLOCKED", redirectTo: "/paid-restricted" }),
      () => json(403, { error: "Forbidden" }),
      () => new Response("nope", { status: 403, headers: { "Content-Type": "text/plain" } }),
    ]) {
      const { win, assign, probes } = fakeWindow("/core", api, () => new Response(null, { status: 307 }))
      await win.fetch("/api/app/x")
      await settle()
      expect(probes()).toHaveLength(0)
      expect(assign).not.toHaveBeenCalled()
    }
  })

  it("never probes from a block page", async () => {
    const { win, probes } = fakeWindow("/vpn-blocked", VPN_403, () => new Response(null, { status: 307 }))
    await win.fetch("/api/app/x")
    await settle()
    expect(probes()).toHaveLength(0)
  })

  it("fails open when the probe itself fails", async () => {
    const { win, assign } = fakeWindow("/core", VPN_403, () => {
      throw new Error("offline")
    })
    await expect(win.fetch("/api/app/x")).resolves.toHaveProperty("status", 403)
    await settle()
    expect(assign).not.toHaveBeenCalled()
  })

  it("installs once", () => {
    const win = { fetch: vi.fn(), location: { href: ORIGIN } } as unknown as Parameters<typeof installGeoRefusalWatcher>[0]
    expect(installGeoRefusalWatcher(win)).toBe(true)
    const wrapped = win.fetch
    expect(installGeoRefusalWatcher(win)).toBe(false)
    expect(win.fetch).toBe(wrapped)
  })
})
