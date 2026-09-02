import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { getServedOrigin, isBindAddressOrigin, isLoopbackOrigin } from "@/lib/http/served-origin"
import { relativeRedirect, relativeUrl } from "@/lib/http/relative-redirect"

/** The origin Next hands a route handler on Railway (`next start -H 0.0.0.0 -p 8080`). */
const BOUND = "https://0.0.0.0:8080"

const ENV_KEYS = [
  "PUBLIC_SITE_URL",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_APP_DOMAIN",
  "NEXTAUTH_URL",
  "APP_URL",
  "SITE_URL",
  "RAILWAY_PUBLIC_DOMAIN",
  "VERCEL_URL",
  "VERCEL_ENV",
  "VERCEL_BRANCH_URL",
] as const

describe("isBindAddressOrigin", () => {
  it("recognises the addresses that mean 'every interface' and reach nothing", () => {
    expect(isBindAddressOrigin(BOUND)).toBe(true)
    expect(isBindAddressOrigin("http://0.0.0.0:3000")).toBe(true)
    expect(isBindAddressOrigin("http://[::]:8080")).toBe(true)
  })

  it("leaves real hosts alone", () => {
    expect(isBindAddressOrigin("https://allfantasy.ai")).toBe(false)
    expect(isBindAddressOrigin("http://localhost:3000")).toBe(false)
    expect(isBindAddressOrigin("not a url")).toBe(false)
  })
})

describe("isLoopbackOrigin", () => {
  it("is true only for the local machine", () => {
    expect(isLoopbackOrigin("http://localhost:3000")).toBe(true)
    expect(isLoopbackOrigin("http://127.0.0.1:3017")).toBe(true)
    expect(isLoopbackOrigin("http://[::1]:3000")).toBe(true)
    expect(isLoopbackOrigin(BOUND)).toBe(false)
    expect(isLoopbackOrigin("https://allfantasy.ai")).toBe(false)
  })
})

describe("relativeRedirect", () => {
  it("emits a Location with no origin at all", () => {
    const res = relativeRedirect("/verify?error=INVALID_LINK")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("/verify?error=INVALID_LINK")
  })

  it("keeps the status the caller asked for", () => {
    expect(relativeRedirect("/login", 303).status).toBe(303)
    expect(relativeRedirect("/verify", 308).status).toBe(308)
  })

  it("carries query and hash through untouched", () => {
    const res = relativeRedirect("/join?code=AB%2FCD#roster")
    expect(res.headers.get("location")).toBe("/join?code=AB%2FCD#roster")
  })

  it("accepts a relativeUrl so callers can add params", () => {
    const target = relativeUrl("/import?provider=yahoo")
    target.searchParams.set("success", "yahoo_connected")
    expect(relativeRedirect(target).headers.get("location")).toBe(
      "/import?provider=yahoo&success=yahoo_connected"
    )
  })

  it("refuses anything that could leave the site", () => {
    // A protocol-relative path is read as an absolute URL by browsers, so it would
    // be an open redirect — the one way a 'relative' Location can go off-site.
    expect(() => relativeRedirect("//evil.example.com")).toThrow()
    expect(() => relativeRedirect("https://evil.example.com/x")).toThrow()
    expect(() => relativeUrl("//evil.example.com")).toThrow()
  })
})

describe("getServedOrigin", () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it("never returns the bind address, even when that is all the request offers", () => {
    process.env.PUBLIC_SITE_URL = "https://www.allfantasy.ai"
    const origin = getServedOrigin({ url: `${BOUND}/api/league/yahoo-auth` })
    expect(origin).toBe("https://www.allfantasy.ai")
    expect(isBindAddressOrigin(origin)).toBe(false)
  })

  it("prefers a loopback request origin, so local dev is not sent to production", () => {
    // A developer's .env.local naming the live site must not make dev links absolute
    // to production — the request origin is the honest answer on a local machine.
    process.env.PUBLIC_SITE_URL = "https://www.allfantasy.ai"
    expect(getServedOrigin({ url: "http://localhost:3017/api/invite/list" })).toBe(
      "http://localhost:3017"
    )
  })

  it("falls back to the canonical site when nothing is configured and nothing is local", () => {
    expect(getServedOrigin({ url: `${BOUND}/api/x` })).toBe("https://www.allfantasy.ai")
  })

  it("works with no request at all", () => {
    process.env.PUBLIC_SITE_URL = "https://allfantasy.ai"
    expect(getServedOrigin()).toBe("https://allfantasy.ai")
    expect(getServedOrigin(null)).toBe("https://allfantasy.ai")
  })

  it("uses the preview host on a preview deployment", () => {
    process.env.VERCEL_ENV = "preview"
    process.env.VERCEL_BRANCH_URL = "my-branch.vercel.app"
    process.env.PUBLIC_SITE_URL = "https://www.allfantasy.ai"
    expect(getServedOrigin({ url: `${BOUND}/api/x` })).toBe("https://my-branch.vercel.app")
  })

  it("ignores a spoofed Host — the origin comes from the environment, not the request", () => {
    process.env.PUBLIC_SITE_URL = "https://www.allfantasy.ai"
    expect(getServedOrigin({ url: "https://evil.example.com/api/invite/list" })).toBe(
      "https://www.allfantasy.ai"
    )
  })
})
