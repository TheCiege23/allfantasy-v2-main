// @vitest-environment node
/**
 * Washington is a full block, and that must reach the API — without reaching
 * the machines.
 *
 * Why this file exists. `routeMiddleware` returns early for every /api/* path,
 * so the Washington block only ever applied to pages: every API answered a WA
 * request normally. #1204 fixed that for PAID routes only, deliberately,
 * because blocking WA from every API reaches machine callers — and a census on
 * 2026-09-24 showed how many:
 *
 *   - 65 API routes outside GEO_EXEMPT_PREFIXES accept a machine credential
 *     (requireCronAuth / CRON_SECRET / requireAdminOrBearer / API keys).
 *   - 10 of the 50 scheduled paths in cron-schedule.json live OUTSIDE /api/cron
 *     (/api/redraft/score-sync, /api/redraft/waiver-process,
 *     /api/tournament/automation, …), so the existing /api/cron exemption does
 *     not cover them. GitHub Actions fires them from Azure, whose West US 2
 *     region is in WASHINGTON, at the WORKER's domain, where no Cloudflare
 *     places the request and the IP fallback reads the runner's address.
 *
 * A path list of 65 would rot the first time someone adds a cron. So the rule
 * exempts the CREDENTIAL, not the path: a request that proves it holds a
 * machine secret is a machine, wherever its IP is. A person in Washington holds
 * none, so they are refused on every route — including the mixed ones that
 * accept both a session and a cron secret.
 *
 * All addresses are RFC 5737 documentation addresses. This repo is public.
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }))
vi.mock("@/lib/geo/geoIpFetch", () => ({ fetchIpApi: vi.fn(async () => null), fetchProxycheck: vi.fn(async () => null) }))

import { getToken } from "next-auth/jwt"
import { fetchIpApi } from "@/lib/geo/geoIpFetch"
import { middleware } from "@/middleware"

const mockedGetToken = vi.mocked(getToken)
const mockedIpApi = vi.mocked(fetchIpApi)

const OWNER_ID = "3a7ffd10-b1a5-4a40-8d07-232364596735"
const CRON = "test-cron-secret-not-a-real-credential-000000000001"
const WORKER = "test-import-worker-secret-not-real-000000000002"

const SECRET_ENVS = [
  "CRON_SECRET",
  "LEAGUE_CRON_SECRET",
  "WORLD_CUP_CRON_SECRET",
  "IMPORT_WORKER_SECRET",
  "BRACKET_ADMIN_SECRET",
  "ADMIN_PASSWORD",
] as const

function fromWA(path: string, headers: Record<string, string> = {}, method = "GET") {
  return new NextRequest(new URL(`https://www.allfantasy.ai${path}`), {
    method,
    headers: { "cf-ipcountry": "US", "cf-region-code": "WA", "cf-connecting-ip": "198.51.100.61", ...headers },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXTAUTH_SECRET = "test-nextauth-secret-not-a-real-credential"
  for (const k of SECRET_ENVS) delete process.env[k]
  process.env.CRON_SECRET = CRON
  process.env.IMPORT_WORKER_SECRET = WORKER
  mockedGetToken.mockResolvedValue(null)
})

afterEach(() => {
  for (const k of SECRET_ENVS) delete process.env[k]
})

const refused = (status: number) => status === 403 || status === 451

describe("a person in Washington is refused on the API, not just on pages", () => {
  for (const path of ["/api/leagues", "/api/instant/player-search?q=al", "/api/core/home", "/api/chat/chimmy"]) {
    it(`403 GEO_BLOCKED on ${path}`, async () => {
      const res = await middleware(fromWA(path))
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toBe("GEO_BLOCKED")
      expect(res.headers.get("location")).toBeNull()
    })
  }

  it("refuses a WRONG machine secret — the credential has to be real", async () => {
    const res = await middleware(fromWA("/api/redraft/score-sync", { authorization: `Bearer ${CRON}x` }))
    expect(res.status).toBe(403)
  })

  it("refuses a same-length wrong secret, which only the comparison itself can catch", async () => {
    const sameLength = CRON.slice(0, -1) + (CRON.endsWith("1") ? "2" : "1")
    const res = await middleware(fromWA("/api/redraft/score-sync", { "x-cron-secret": sameLength }))
    expect(res.status).toBe(403)
  })
})

describe("every scheduled job still runs from a Washington address", () => {
  const schedule = JSON.parse(readFileSync(resolve(__dirname, "../cron-schedule.json"), "utf8"))
  const crons: Array<{ path: string }> = Array.isArray(schedule) ? schedule : schedule.crons
  const paths = [...new Set(crons.map((c) => String(c.path).split("?")[0]))]

  it("found the schedule (control: a census of nothing passes vacuously)", () => {
    expect(paths.length).toBeGreaterThan(30)
    expect(paths.some((p) => !p.startsWith("/api/cron/"))).toBe(true)
  })

  for (const path of paths) {
    it(`${path} — Bearer CRON_SECRET from WA is not refused`, async () => {
      const res = await middleware(fromWA(path, { authorization: `Bearer ${CRON}` }))
      expect(refused(res.status)).toBe(false)
    })
  }
})

describe("each header and secret requireCronAuth accepts is honoured", () => {
  it("x-cron-secret with IMPORT_WORKER_SECRET (the import chain)", async () => {
    const res = await middleware(fromWA("/api/leagues/import/internal-step", { "x-cron-secret": WORKER }, "POST"))
    expect(refused(res.status)).toBe(false)
  })

  it("x-admin-secret with BRACKET_ADMIN_SECRET", async () => {
    process.env.BRACKET_ADMIN_SECRET = "test-bracket-admin-secret-not-real-0003"
    const res = await middleware(fromWA("/api/bracket/workers/sync-playoff", { "x-admin-secret": "test-bracket-admin-secret-not-real-0003" }))
    expect(refused(res.status)).toBe(false)
  })

  it("WORLD_CUP_CRON_SECRET, which two world-cup crons prefer", async () => {
    process.env.WORLD_CUP_CRON_SECRET = "test-world-cup-cron-secret-not-real-0004"
    const res = await middleware(fromWA("/api/brackets/world-cup/cron/sync", { authorization: "Bearer test-world-cup-cron-secret-not-real-0004" }))
    expect(refused(res.status)).toBe(false)
  })

  it("an unset secret never matches an empty credential", async () => {
    delete process.env.CRON_SECRET
    delete process.env.IMPORT_WORKER_SECRET
    const res = await middleware(fromWA("/api/leagues", { authorization: "Bearer " }))
    expect(res.status).toBe(403)
  })
})

describe("machine surfaces exempt by prefix — their handlers enforce their own keys", () => {
  it("/api/internal (x-internal-key / x-ingestion-key)", async () => {
    expect(refused((await middleware(fromWA("/api/internal/analyze-trades", {}, "POST"))).status)).toBe(false)
  })

  it("/api/v1 — the partner Intelligence API, gated by API keys", async () => {
    expect(refused((await middleware(fromWA("/api/v1/intelligence/league"))).status)).toBe(false)
  })

  it("the paths that were already exempt stay exempt", async () => {
    for (const p of ["/api/health", "/api/auth/session", "/api/geo/check", "/api/cron/import-players", "/api/stripe/webhook"]) {
      expect(refused((await middleware(fromWA(p))).status)).toBe(false)
    }
  })
})

describe("who else is not refused", () => {
  it("the app owner, as on pages", async () => {
    mockedGetToken.mockResolvedValue({ sub: OWNER_ID } as never)
    expect(refused((await middleware(fromWA("/api/leagues"))).status)).toBe(false)
  })

  it("a paid-block state on a NON-paid route (free play is legal there)", async () => {
    const res = await middleware(
      new NextRequest(new URL("https://www.allfantasy.ai/api/leagues"), { headers: { "cf-ipcountry": "US", "cf-region-code": "NV" } }),
    )
    expect(refused(res.status)).toBe(false)
  })

  it("an unrestricted state", async () => {
    const res = await middleware(
      new NextRequest(new URL("https://www.allfantasy.ai/api/leagues"), { headers: { "cf-ipcountry": "US", "cf-region-code": "NJ" } }),
    )
    expect(refused(res.status)).toBe(false)
  })
})

describe("cost", () => {
  it("a machine credential skips the location lookup entirely — no IP-geo vendor call", async () => {
    // ⚠ IPAPI_KEY MUST BE SET or this assertion is vacuous: the IP fallback
    // returns before calling the vendor when no key is configured, so the call
    // count is zero whatever order the checks run in. A mutation moving the
    // credential check after the lookup survived until this line was added.
    process.env.IPAPI_KEY = "test-ipapi-key-not-a-real-credential"
    try {
      // No Cloudflare headers: exactly how a GitHub runner reaches the worker.
      // A fresh address, so the fallback's per-IP cache cannot answer instead.
      const res = await middleware(
        new NextRequest(new URL("https://www.allfantasy.ai/api/redraft/score-sync"), {
          headers: { authorization: `Bearer ${CRON}`, "x-real-ip": "198.51.100.62" },
        }),
      )
      expect(refused(res.status)).toBe(false)
      expect(mockedIpApi).not.toHaveBeenCalled()

      // Control: the same request WITHOUT the credential does reach the vendor.
      await middleware(
        new NextRequest(new URL("https://www.allfantasy.ai/api/redraft/score-sync"), {
          headers: { "x-real-ip": "198.51.100.63" },
        }),
      )
      expect(mockedIpApi).toHaveBeenCalled()
    } finally {
      delete process.env.IPAPI_KEY
    }
  })

  it("an ordinary request from an unrestricted state decodes no session", async () => {
    await middleware(
      new NextRequest(new URL("https://www.allfantasy.ai/api/leagues"), { headers: { "cf-ipcountry": "US", "cf-region-code": "NJ" } }),
    )
    expect(mockedGetToken).not.toHaveBeenCalled()
  })
})
