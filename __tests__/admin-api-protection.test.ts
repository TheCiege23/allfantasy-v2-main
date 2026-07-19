import { readdirSync, readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

function read(rel: string) {
  return readFileSync(resolve(process.cwd(), rel), "utf-8")
}

function routeFiles(dir: string): string[] {
  const absolute = resolve(process.cwd(), dir)
  return readdirSync(absolute).flatMap((entry) => {
    const rel = `${dir}/${entry}`.replaceAll("\\", "/")
    const full = resolve(process.cwd(), rel)
    if (statSync(full).isDirectory()) return routeFiles(rel)
    return entry === "route.ts" ? [rel] : []
  })
}

/**
 * Call expressions that constitute an accepted server-side admin gate.
 *
 * Adding an entry here widens what the guard will accept, so each one must be
 * at least as strict as `requireAdmin()`. Verify the allowlist it resolves to
 * before adding — a helper that admits MORE people than `requireAdmin` is not a
 * valid substitute, it is a hole.
 */
const ADMIN_GATE_CALLS = [
  // lib/adminAuth.ts — admin cookie session, or app session on the
  // ADMIN_EMAILS allowlist / isSiteAdmin.
  "requireAdmin(",
  "requireAdminOrBearer(",
  "getAdminAccessState(",

  // lib/decision-os/core/telemetryDebugAccess.ts — resolves to isDevAdminUserId
  // (STATIC_ADMIN_USER_IDS + DEV_ADMIN_USER_IDS), which is STRICTER than
  // requireAdmin's ADMIN_EMAILS allowlist, and the surface is additionally
  // 404'd outside non-production by isDecisionTelemetryDebugSurfaceEnabled().
  // Deliberately NOT converted to requireAdmin(): that would widen access from
  // two owner accounts to the whole ADMIN_EMAILS list.
  "canAccessDecisionTelemetryDebugSurface(",
] as const

/**
 * Remove comments before matching, so a gate that was commented out during
 * debugging cannot satisfy the check. Erring toward stripping too much only
 * makes the guard stricter (a false failure, caught immediately), never looser.
 * The `[^:]` guard keeps `https://` in string literals from being treated as a
 * line comment.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

function isProtected(route: string, source: string): boolean {
  const code = stripComments(source)
  const hasAdminGate = ADMIN_GATE_CALLS.some((gate) => code.includes(gate))
  const hasBootstrapGate =
    route.includes("/bootstrap/") &&
    code.includes("ADMIN_BOOTSTRAP_ENABLED") &&
    code.includes("ADMIN_BOOTSTRAP_PASSWORD")

  return hasAdminGate || hasBootstrapGate
}

describe("admin API server-side protection", () => {
  const adminApiRoutes = routeFiles("app/api/admin")

  it("discovers the admin route surface", () => {
    // Without this, a broken glob returns [] and every assertion below passes
    // vacuously — a green guard that checks nothing. The exact number is
    // expected to grow; this only asserts discovery is not silently empty.
    expect(adminApiRoutes.length).toBeGreaterThan(20)
  })

  it("keeps every /api/admin route behind an explicit server gate", () => {
    // Collect ALL unprotected routes rather than expect()-ing inside the loop.
    // A per-iteration assertion throws on the first miss, leaving every route
    // after it unchecked — so a single known failure silently disabled the
    // guard for the rest of the surface.
    const unprotected = adminApiRoutes.filter((route) => !isProtected(route, read(route)))

    expect(
      unprotected,
      `These /api/admin routes have no admin auth or explicit bootstrap env gating:\n` +
        unprotected.map((r) => `  - ${r}`).join("\n"),
    ).toEqual([])
  })
})
