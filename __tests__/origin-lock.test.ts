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
