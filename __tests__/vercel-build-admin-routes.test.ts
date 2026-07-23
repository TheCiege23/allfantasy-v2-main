import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Admin surface deployment contract.
 *
 * HISTORY — why this test changed shape:
 *   2026-06-04 b7aa1ff96 "Restore admin route" removed app/admin + app/api/admin from
 *     routeDirsToDisable (the staff admin surface had been build-excluded and was 404ing
 *     in production) and added this test as `not.toContain` on BOTH paths.
 *   2026-06-22 43f9ae44c (#100) re-added BOTH exclusions because Vercel hit the 2048-route
 *     cap (received 2049). It updated route-budget.test.ts, route-budget-count.mjs and the
 *     docs — but never updated THIS file, leaving it red on main ever since.
 *   2026-06-26 35fb8ff4e "Preserve admin routes in production build" removed the app/admin
 *     (UI) exclusion again and instead introduced the per-route `filesToKeep` allowlist.
 *
 * So the original guard was half right. The CURRENT contract is:
 *   - app/admin/**      (staff UI pages)  -> SHIPS. Never build-exclude it.
 *   - app/api/admin/**  (admin API)       -> EXCLUDED WHOLESALE, with an explicit
 *                                            per-route keep-list for the routes that
 *                                            real shipping callers depend on.
 *
 * This test now enforces BOTH halves rather than the obsolete "never exclude anything
 * under admin" rule. It must keep failing if either half is violated: re-excluding the
 * staff UI 404s the dashboard, and blanket-restoring app/api/admin blows the route budget.
 */

const root = process.cwd()

function buildScript(): string {
  return readFileSync(path.join(root, "scripts", "vercel-next-build.cjs"), "utf8")
}

/** Admin route keeps expressed as `path.join('app', 'api', 'admin', ..., 'route.ts')`. */
function keptAdminRoutesInBuildScript(): string[] {
  const matches = buildScript().matchAll(/'app', 'api', 'admin'(?:, '[^']+')*, 'route\.ts'/g)
  return [...matches].map((m) => m[0].replace(/'/g, "").replace(/, /g, "/")).sort()
}

/** Admin route keeps in the two plain-string keep-lists. */
function keptAdminRoutesIn(relFile: string): string[] {
  const src = readFileSync(path.join(root, relFile), "utf8")
  return [...src.matchAll(/'(app\/api\/admin\/[^']*route\.ts)'/g)].map((m) => m[1]).sort()
}

function keptAdminRoutesFor(file: string): string[] {
  return file === "scripts/vercel-next-build.cjs"
    ? keptAdminRoutesInBuildScript()
    : keptAdminRoutesIn(file)
}

/**
 * The three routes backing components/admin/UsageAnalyticsPanel, which is mounted by
 * app/leagues/[leagueId]/admin/model/page.tsx — a LEAGUE page, not app/admin/**, so it
 * ships. usage/log is fetched from ordinary end-user sessions by app/hooks/useAnalytics.ts
 * and lib/telemetry/client.ts. All three 404'd in production until they were keep-listed.
 */
const USAGE_ROUTES = [
  "app/api/admin/usage/route.ts",
  "app/api/admin/usage/summary/route.ts",
  "app/api/admin/usage/log/route.ts",
]

/** Every hand-maintained copy of the keep-list. Nothing else asserts they agree. */
const KEEP_LIST_FILES = [
  "scripts/vercel-next-build.cjs",
  "scripts/route-budget-count.mjs",
  "__tests__/route-budget.test.ts",
]

/**
 * An internal-diagnostics admin route with no shipping caller. It is the control for
 * "selective, not blanket": if this ever becomes keep-listed, either it gained a real
 * production caller (then say so here) or someone widened the keep-list carelessly.
 */
const CONTROL_EXCLUDED_ROUTE = "app/api/admin/metrics/route.ts"

describe("Vercel build route exclusions — admin surface contract", () => {
  // ── Half 1: the original guard, still load-bearing ──────────────────────────
  it("does not exclude the production admin command center (app/admin UI)", () => {
    // Restored by 35fb8ff4e. Re-adding this line 404s the entire staff dashboard —
    // exactly the regression b7aa1ff96 introduced this test to prevent.
    expect(buildScript()).not.toContain("path.join('app', 'admin')")
  })

  // ── Half 2: the architecture that superseded the obsolete assertion ─────────
  it("excludes app/api/admin wholesale, as the route budget requires", () => {
    // Deliberate since #100 — the admin API tree is internal-only, and shipping all of
    // it is what pushed Vercel to 2049/2048. Removing this line silently re-ships the
    // whole tree and the deployment fails at process-and-upload-routes AFTER a green
    // build. Restore individual routes via filesToKeep instead.
    expect(buildScript()).toContain("path.join('app', 'api', 'admin'),")
  })

  it("restores admin API routes SELECTIVELY, never as a blanket re-include", () => {
    const kept = keptAdminRoutesInBuildScript()

    expect(kept.length).toBeGreaterThan(0)
    // A keep-list covering every admin route is a blanket restore wearing a keep-list
    // costume — it would defeat the wholesale exclusion above.
    expect(kept, "keep-list must stay a strict subset of the admin API tree").not.toContain(
      CONTROL_EXCLUDED_ROUTE
    )
    expect(existsSync(path.join(root, CONTROL_EXCLUDED_ROUTE)), "control route must exist").toBe(
      true
    )
  })

  it("keeps only routes that actually exist — a dangling keep is a silent no-op", () => {
    // filesToKeep is matched by exact relative path, so a keep entry for a moved or
    // deleted route matches nothing and quietly protects nothing.
    const missing = keptAdminRoutesInBuildScript().filter((f) => !existsSync(path.join(root, f)))
    expect(missing, `keep-listed but absent from disk: ${missing.join(", ")}`).toEqual([])
  })

  // ── Regression coverage: the usage routes must not fall back into 404 ───────
  describe("admin usage routes stay deployable", () => {
    for (const route of USAGE_ROUTES) {
      it(`${route} exists on disk`, () => {
        expect(existsSync(path.join(root, route))).toBe(true)
      })
    }

    for (const file of KEEP_LIST_FILES) {
      it(`${file} keep-lists all three usage routes`, () => {
        const kept = keptAdminRoutesFor(file)
        const missing = USAGE_ROUTES.filter((r) => !kept.includes(r))
        expect(missing, `${file} is missing: ${missing.join(", ")}`).toEqual([])
      })
    }

    it("all three keep-lists agree on the usage routes", () => {
      // The lists are hand-copied and drift silently. #100's root cause was exactly
      // this class of drift: the build script and the budget test disagreed about what
      // actually shipped.
      const expected = [...USAGE_ROUTES].sort()
      for (const file of KEEP_LIST_FILES) {
        const usage = keptAdminRoutesFor(file)
          .filter((r) => r.startsWith("app/api/admin/usage/"))
          .sort()
        expect(usage, `${file} disagrees on the usage keep set`).toEqual(expected)
      }
    })
  })
})
