// @vitest-environment node
/**
 * Pins that MACHINE callers skip the geo gate.
 *
 * 🛑 THIS IS A LATENT OUTAGE THAT ONLY FIRES ONCE GEO DETECTION WORKS, which is
 * why it survived unnoticed and was nearly shipped. `WA` is the one full_block
 * state; this repo fires its crons over HTTP from GitHub Actions
 * (.github/workflows/cron-slow-tier.yml, wc-cron.yml -> ${APP_URL}/api/cron/…);
 * GitHub Actions runs on Azure, whose West US 2 region is in Quincy, WASHINGTON.
 * A runner on a WA address reaches the gate with no session, so
 * isMiddlewareAdmin is false, and the job takes a 403 GEO_BLOCKED and fails
 * silently.
 *
 * It could not fire while `country` was null for every request — so this bug and
 * the outage that hid it are the same bug, and repairing geo detection is
 * precisely what arms it. Both routes to a working gate trip it: the IP fallback
 * in this PR, and proxying the hostname through Cloudflare.
 *
 * The list is asserted BY ENUMERATING THE ROUTE TREE rather than by restating a
 * hand-written list, so a cron or webhook added later fails this test instead of
 * silently joining the exposed set.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative, sep, dirname } from "node:path"

import { describe, expect, it } from "vitest"

/** Read GEO_EXEMPT_PREFIXES straight out of middleware.ts — the real list, not a copy. */
function readExemptPrefixes(): string[] {
  const src = readFileSync("middleware.ts", "utf8")
  const block = src.slice(
    src.indexOf("const GEO_EXEMPT_PREFIXES = ["),
    src.indexOf("]", src.indexOf("const GEO_EXEMPT_PREFIXES = [")),
  )
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string)
}

const EXEMPT = readExemptPrefixes()
const isExempt = (p: string) => EXEMPT.some((x) => p === x || p.startsWith(`${x}/`))

/** Every App Router route path under app/api. */
function routeUrls(dir = "app/api"): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name)
      if (e.isDirectory()) walk(f)
      else if (/^route\.(ts|js)$/.test(e.name)) {
        out.push(`/${relative("app", dirname(f)).split(sep).join("/")}`)
      }
    }
  }
  walk(dir)
  return out
}

const HAS_ROUTES = existsSync("app/api")

describe.skipIf(!HAS_ROUTES)("machine callers are exempt from the geo gate", () => {
  const urls = routeUrls()

  it("finds the route tree at all (guards against a vacuous pass)", () => {
    // Without this, a move of app/api would make every assertion below pass by
    // iterating an empty list — the check-that-cannot-fail shape.
    expect(urls.length).toBeGreaterThan(50)
    expect(urls).toContain("/api/cron/import-players")
  })

  it("exempts EVERY cron route, because GitHub Actions runners can be in WA", () => {
    const crons = urls.filter((u) => u.startsWith("/api/cron/"))
    expect(crons.length).toBeGreaterThan(30)
    expect(crons.filter((u) => !isExempt(u))).toEqual([])
  })

  it("exempts every provider webhook — a payment callback has no user to restrict", () => {
    const hooks = urls.filter((u) => /webhook/i.test(u))
    expect(hooks.length).toBeGreaterThan(0)
    expect(hooks.filter((u) => !isExempt(u))).toEqual([])
  })

  it("does NOT exempt paths that serve a human", () => {
    // The other half of the rule. An over-broad prefix here would quietly
    // disable the restriction it exists to enforce, which is worse than the
    // outage above because nothing anywhere goes red.
    for (const humanPath of [
      "/dashboard",
      "/api/leagues/import",
      "/api/subscription/checkout",
      "/league/abc/dispersal-draft",
      "/dashboard/rankings",
    ]) {
      expect(isExempt(humanPath)).toBe(false)
    }
  })
})
