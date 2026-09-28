// @vitest-environment node
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { describe, expect, it, vi } from "vitest"

const script = readFileSync("public/sw.js", "utf8")

function worker(fetchResponse: () => Promise<Response>) {
  const listeners = new Map<string, (event: any) => void>()
  const store = new Map<string, Response>()
  const caches = {
    match: vi.fn(async (key: Request | string) => store.get(typeof key === "string" ? key : new URL(key.url).pathname)),
    open: vi.fn(async () => ({
      put: async (key: Request | string, value: Response) => {
        store.set(typeof key === "string" ? key : new URL(key.url).pathname, value)
      },
    })),
  }
  const fetch = vi.fn(fetchResponse)
  const self = {
    location: { origin: "https://www.allfantasy.ai" },
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
  }
  runInNewContext(script, { self, caches, fetch, URL, Response, console })

  async function navigate() {
    let response: Promise<Response> | undefined
    listeners.get("fetch")!({
      request: { method: "GET", mode: "navigate", url: "https://www.allfantasy.ai/core" },
      preloadResponse: Promise.resolve(undefined),
      respondWith: (value: Promise<Response>) => { response = value },
    })
    return response!
  }
  return { navigate, store, caches, fetch }
}

describe("iPhone home-screen VPN recovery", () => {
  it("fetches the app again after a VPN redirect instead of replaying the blocked page", async () => {
    let blocked = true
    const sw = worker(async () => blocked
      ? Response.redirect("https://www.allfantasy.ai/vpn-blocked?from=%2Fcore", 307)
      : new Response("app", { status: 200 }))

    expect((await sw.navigate()).status).toBe(307)
    blocked = false
    expect(await (await sw.navigate()).text()).toBe("app")
    expect(sw.fetch).toHaveBeenCalledTimes(2)
    expect(sw.store.has("/core")).toBe(false)
  })

  it("uses the offline page instead of a stale VPN block when the connection drops", async () => {
    const sw = worker(async () => { throw new Error("network down") })
    sw.store.set("/core", new Response("stale VPN block"))
    sw.store.set("/offline", new Response("offline help"))

    expect(await (await sw.navigate()).text()).toBe("offline help")
    expect(sw.caches.match).toHaveBeenCalledWith("/offline")
  })
})
