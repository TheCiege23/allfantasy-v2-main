import { afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/ph-assets/[...path]/route"

/**
 * us-assets.i.posthog.com is behind Cloudflare, which answers 403 "DNS points to
 * prohibited IP" when a request carries the visitor's cf-* headers — exactly what a
 * Next.js external rewrite forwards. The route must send none of them.
 */
function visitorRequest(url: string) {
  return new NextRequest(url, {
    headers: {
      accept: "application/javascript",
      "cf-connecting-ip": "203.0.113.7",
      "cf-ray": "a405c9b589982688-ORD",
      "cf-ipcountry": "US",
      "cdn-loop": "cloudflare",
      "x-forwarded-for": "203.0.113.7",
      cookie: "next-auth.session-token=secret",
    },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("GET /api/ph-assets/[...path]", () => {
  it("fetches the asset from us-assets.i.posthog.com with only an Accept header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("/* js */", {
        status: 200,
        headers: { "content-type": "application/javascript", "cache-control": "public, max-age=3600", "set-cookie": "x=1" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const res = await GET(visitorRequest("https://www.allfantasy.ai/ingest/static/exception-autocapture.js?v=1.422.5"), {
      params: { path: ["static", "exception-autocapture.js"] },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://us-assets.i.posthog.com/static/exception-autocapture.js?v=1.422.5")
    expect(init.headers).toEqual({ accept: "application/javascript" })

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/javascript")
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600")
    expect(res.headers.get("set-cookie")).toBeNull()
    expect(await res.text()).toBe("/* js */")
  })

  it("proxies the remote-config path under /array", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }))
    vi.stubGlobal("fetch", fetchMock)

    await GET(visitorRequest("https://www.allfantasy.ai/ingest/array/phc_abc/config"), {
      params: { path: ["array", "phc_abc", "config"] },
    })

    expect(fetchMock.mock.calls[0][0]).toBe("https://us-assets.i.posthog.com/array/phc_abc/config")
  })

  it("refuses anything outside static/ and array/ without calling upstream", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    for (const path of [["e"], ["decide"], ["static"], ["..", "etc"]]) {
      const res = await GET(visitorRequest("https://www.allfantasy.ai/x"), { params: { path } })
      expect(res.status).toBe(404)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns 502 when the upstream fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")))

    const res = await GET(visitorRequest("https://www.allfantasy.ai/ingest/static/a.js"), {
      params: { path: ["static", "a.js"] },
    })
    expect(res.status).toBe(502)
  })
})
