// @vitest-environment node
/**
 * The origin must only answer requests that came through Cloudflare.
 *
 * Why this file exists. Measured 2026-09-24 against production, with read-only
 * GETs to our own service:
 *
 *   - the service's own `.up.railway.app` domain answers directly, and
 *   - `Host: www.allfantasy.ai` sent straight to Railway's edge IP gets a valid
 *     certificate and a 200 — so deleting the Railway domain would NOT close it.
 *
 * Either way the app trusted forged Cloudflare headers completely:
 * `cf-ipcountry: CA` turned a Washington visitor into an unrestricted Canadian,
 * and a forged `cf-connecting-ip` resets every per-IP rate limit. Railway has no
 * inbound IP allow-list, so the lock lives here: Cloudflare stamps a secret
 * header on every request it forwards, and the middleware refuses the rest.
 *
 * ⚠ THE LOCK IS OFF UNLESS ITS SECRET IS SET, and that is load-bearing. The
 * crons call the WORKER's own `.up.railway.app` domain (GitHub `vars.APP_URL`),
 * which no Cloudflare fronts, and the worker runs this same middleware. The
 * secret is configured on `allfantasy-v2-main` only.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

import {
  ORIGIN_AUTH_HEADER,
  __resetOriginLockReports,
  checkOriginLock,
  secretsMatch,
} from "@/lib/http/originLock"
import { middleware } from "@/middleware"

const SECRET = "test-origin-secret-not-a-real-credential-0123456789"

function req(path: string, headers: Record<string, string> = {}, host = "www.allfantasy.ai") {
  return new NextRequest(new URL(`https://${host}${path}`), { headers })
}

const viaCloudflare = (path: string) =>
  req(path, { [ORIGIN_AUTH_HEADER]: SECRET, "cf-ipcountry": "US", "cf-region-code": "NJ" })

/** A direct hit on the origin forging the headers Cloudflare would have set. */
const forged = (path: string) => req(path, { "cf-ipcountry": "CA", "cf-connecting-ip": "198.51.100.7" })

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  __resetOriginLockReports()
  delete process.env.CF_ORIGIN_AUTH_SECRET
  delete process.env.CF_ORIGIN_LOCK_MODE
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  warn.mockRestore()
  delete process.env.CF_ORIGIN_AUTH_SECRET
  delete process.env.CF_ORIGIN_LOCK_MODE
})

describe("enforce: a direct hit is refused, Cloudflare traffic is not", () => {
  beforeEach(() => {
    process.env.CF_ORIGIN_AUTH_SECRET = SECRET
    process.env.CF_ORIGIN_LOCK_MODE = "enforce"
  })

  it("REFUSES a forged-Canada request with no edge secret — the bypass measured in production", async () => {
    const res = await middleware(forged("/api/geo/check"))
    expect(res.status).toBe(403)
  })

  it("refuses page requests too, not just the API", async () => {
    expect((await middleware(forged("/pricing"))).status).toBe(403)
  })

  it("refuses a WRONG secret, including one that is a prefix of the right one", async () => {
    const wrong = req("/api/geo/check", { [ORIGIN_AUTH_HEADER]: SECRET.slice(0, -1) })
    expect((await middleware(wrong)).status).toBe(403)
  })

  it("lets a request carrying the edge secret through", async () => {
    const res = await middleware(viaCloudflare("/api/geo/check"))
    expect(res.status).not.toBe(403)
  })

  it("never refuses the Railway healthcheck, which hits the container without Cloudflare", async () => {
    const res = await middleware(req("/api/health"))
    expect(res.status).not.toBe(403)
  })

  it("does not echo the secret or the reason in the refusal body", async () => {
    const res = await middleware(forged("/api/geo/check"))
    const body = await res.text()
    expect(body).not.toContain(SECRET)
    expect(body).not.toContain(ORIGIN_AUTH_HEADER)
  })
})

/**
 * Why a page is REDIRECTED rather than refused.
 *
 * Measured 2026-09-24 in Railway's http logs, the full 24 hours of requests to
 * the origin's own `.up.railway.app` host: no cron, webhook or provider callback
 * — but Googlebot on /robots.txt and AdsBot-Google on /brackets/leagues/new and
 * its assets. AdsBot only fetches AD LANDING PAGES, so a Google Ads final URL
 * points at the origin host, and a 403 there is how an ad gets disapproved.
 * A 308 to the canonical host sends the same request back through Cloudflare,
 * which sets its own location headers over any forged ones — no less secure.
 */
describe("enforce: a direct PAGE request is sent to the canonical host", () => {
  const ORIGIN_HOST = "example-origin.up.railway.app"
  let savedSiteUrl: string | undefined

  beforeEach(() => {
    process.env.CF_ORIGIN_AUTH_SECRET = SECRET
    process.env.CF_ORIGIN_LOCK_MODE = "enforce"
    savedSiteUrl = process.env.NEXT_PUBLIC_SITE_URL
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.allfantasy.ai"
  })

  afterEach(() => {
    if (savedSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
    else process.env.NEXT_PUBLIC_SITE_URL = savedSiteUrl
  })

  /** A direct hit, with the Host header the origin actually receives. */
  function direct(path: string, method = "GET", host = ORIGIN_HOST, headers: Record<string, string> = {}) {
    return new NextRequest(new URL(`https://${host}${path}`), { method, headers: { host, ...headers } })
  }

  it("308s an ad landing page on the origin host to www, keeping path and query", async () => {
    const res = await middleware(direct("/brackets/leagues/new?utm_source=google&gclid=abc"))
    expect(res.status).toBe(308)
    expect(res.headers.get("location")).toBe("https://www.allfantasy.ai/brackets/leagues/new?utm_source=google&gclid=abc")
  })

  it("308s HEAD too — link checkers and crawlers use it", async () => {
    const res = await middleware(direct("/brackets/leagues/new", "HEAD"))
    expect(res.status).toBe(308)
  })

  it("still 403s an API call — a machine gets a clear refusal, never a redirect", async () => {
    const res = await middleware(direct("/api/geo/check"))
    expect(res.status).toBe(403)
    expect(res.headers.get("location")).toBeNull()
  })

  it("still 403s a POST — a redirect would change what the request means", async () => {
    const res = await middleware(direct("/pricing", "POST"))
    expect(res.status).toBe(403)
  })

  it("403s — does NOT redirect — a direct request that already claims the canonical host", async () => {
    // Host: www.allfantasy.ai sent straight to Railway's IP. Redirecting to itself
    // would loop, and if the Cloudflare rule were ever removed, EVERY visitor would
    // hit ERR_TOO_MANY_REDIRECTS instead of a clear 403.
    const res = await middleware(direct("/core", "GET", "www.allfantasy.ai"))
    expect(res.status).toBe(403)
    expect(res.headers.get("location")).toBeNull()
  })

  it("is not an open redirect: a path of //evil.example stays on our host", async () => {
    const res = await middleware(direct("//evil.example/x"))
    expect(res.status).toBe(308)
    expect(new URL(res.headers.get("location")!).hostname).toBe("www.allfantasy.ai")
  })

  it("does not follow a forged forwarded-host header anywhere", async () => {
    const res = await middleware(direct("/core", "GET", ORIGIN_HOST, { "x-forwarded-host": "evil.example" }))
    expect(new URL(res.headers.get("location")!).hostname).toBe("www.allfantasy.ai")
  })

  it("403s when the configured canonical host IS the origin host — the loop guard", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = `https://${ORIGIN_HOST}`
    const res = await middleware(direct("/core"))
    expect(res.status).toBe(403)
    expect(res.headers.get("location")).toBeNull()
  })

  it("403s when the canonical host is ANY Railway origin host — it bypasses Cloudflare too", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://some-other-service.up.railway.app"
    const res = await middleware(direct("/core"))
    expect(res.status).toBe(403)
  })

  it("403s when there is no Host header to reason about", async () => {
    const res = await middleware(new NextRequest(new URL(`https://${ORIGIN_HOST}/core`)))
    expect(res.status).toBe(403)
  })

  it("logs a redirect as a redirect, and never the secret", async () => {
    await middleware(direct("/brackets/leagues/new"))
    const logged = warn.mock.calls.map((c) => c.join(" ")).join("\n")
    expect(logged).toMatch(/origin-lock.*redirected/)
    expect(logged).toMatch(/\/brackets\/leagues\/new/)
    expect(logged).not.toContain(SECRET)
  })

  it("lets Cloudflare traffic straight through — no redirect for a request carrying the secret", async () => {
    const res = await middleware(direct("/brackets/leagues/new", "GET", "www.allfantasy.ai", { [ORIGIN_AUTH_HEADER]: SECRET }))
    expect([301, 302, 307, 308, 403]).not.toContain(res.status)
  })

  it("report mode still refuses and redirects nothing", async () => {
    process.env.CF_ORIGIN_LOCK_MODE = "report"
    const res = await middleware(direct("/brackets/leagues/new"))
    expect([308, 403]).not.toContain(res.status)
  })
})

describe("OFF by default — the worker and every unconfigured environment", () => {
  it("lets a direct hit through when no secret is set, even with mode=enforce", async () => {
    process.env.CF_ORIGIN_LOCK_MODE = "enforce"
    expect((await middleware(forged("/api/geo/check"))).status).not.toBe(403)
  })

  it("lets a direct hit through when the secret is set but mode is unset", async () => {
    process.env.CF_ORIGIN_AUTH_SECRET = SECRET
    expect((await middleware(forged("/api/geo/check"))).status).not.toBe(403)
  })
})

describe("report: logs what WOULD be refused, refuses nothing", () => {
  beforeEach(() => {
    process.env.CF_ORIGIN_AUTH_SECRET = SECRET
    process.env.CF_ORIGIN_LOCK_MODE = "report"
  })

  it("lets the direct hit through and says so in the log", async () => {
    expect((await middleware(forged("/api/geo/check"))).status).not.toBe(403)
    const logged = warn.mock.calls.map((c) => c.join(" ")).join("\n")
    expect(logged).toMatch(/origin-lock/)
    expect(logged).toMatch(/\/api\/geo\/check/)
  })

  it("never logs the secret", async () => {
    await middleware(req("/api/geo/check", { [ORIGIN_AUTH_HEADER]: "wrong-value" }))
    const logged = warn.mock.calls.map((c) => c.join(" ")).join("\n")
    expect(logged).not.toContain(SECRET)
    expect(logged).not.toContain("wrong-value")
  })

  it("does not log Cloudflare traffic", async () => {
    await middleware(viaCloudflare("/api/geo/check"))
    expect(warn.mock.calls.some((c) => c.join(" ").includes("origin-lock"))).toBe(false)
  })

  it("bounds the log: one line per path, not one per request", async () => {
    for (let i = 0; i < 20; i++) await middleware(forged("/api/geo/check"))
    const lines = warn.mock.calls.filter((c) => c.join(" ").includes("origin-lock"))
    expect(lines.length).toBe(1)
  })
})

describe("the pieces", () => {
  it("refuses a wrong secret of the SAME length — the only case the length check cannot catch", async () => {
    // Every other wrong secret here differs in length and is rejected before the
    // comparison runs. A mutation making the comparison always-true survived all of
    // them; this is the test that makes the comparison itself load-bearing.
    process.env.CF_ORIGIN_AUTH_SECRET = SECRET
    process.env.CF_ORIGIN_LOCK_MODE = "enforce"
    const sameLength = SECRET.slice(0, -1) + (SECRET.endsWith("9") ? "8" : "9")
    expect(sameLength).toHaveLength(SECRET.length)
    expect(sameLength).not.toBe(SECRET)
    expect(secretsMatch(SECRET, sameLength)).toBe(false)
    expect((await middleware(req("/api/geo/check", { [ORIGIN_AUTH_HEADER]: sameLength }))).status).toBe(403)
  })

  it("compares secrets exactly", () => {
    expect(secretsMatch(SECRET, SECRET)).toBe(true)
    expect(secretsMatch(SECRET, SECRET + "x")).toBe(false)
    expect(secretsMatch(SECRET, "")).toBe(false)
    expect(secretsMatch("", "")).toBe(false)
  })

  it("an unknown mode is treated as off, not as enforce — a typo must not take the site down", () => {
    const env = { CF_ORIGIN_AUTH_SECRET: SECRET, CF_ORIGIN_LOCK_MODE: "enfroce" }
    expect(checkOriginLock(new Headers(), "/api/x", env).action).toBe("allow")
  })
})
