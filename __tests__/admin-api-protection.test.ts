import { readdirSync, readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Guard: every `/api/admin` route must sit behind a real server-side admin gate.
 *
 * Two properties this test is designed to have, both learned from how it failed
 * before:
 *
 *  1. **It reports every offender, not the first.** The original asserted inside
 *     the loop, so the run aborted on the first ungated route and any others
 *     stayed invisible until that one was fixed. Offenders are now collected and
 *     asserted once, so a single miss can never mask another.
 *
 *  2. **A gate named only in a comment does not count.** Block comments and
 *     whole-line `//` comments are stripped before matching, so prose that
 *     mentions `requireAdmin(` cannot satisfy the guard. (Inline trailing
 *     comments are deliberately left in place — stripping them risks mangling
 *     `https://` inside string literals, and the doc-comment case is the one
 *     that actually occurs.)
 *
 * ── On the recognized set ────────────────────────────────────────────────────
 *
 * `RECOGNIZED_GATES` lists only helpers that resolve the **canonical** admin
 * authority — `getAdminAccessState`, i.e. email / username / verified
 * `admin_session` cookie role.
 *
 * `canAccessDecisionTelemetryDebugSurface` is deliberately NOT in this list, and
 * must not be added. It delegates to `isDevAdminUserId`, which keys on **user
 * id** (`DEV_ADMIN_USER_IDS` plus two hardcoded owner uuids) — a different key
 * space from the canonical gate, containing and contained by neither. A user in
 * `DEV_ADMIN_USER_IDS` but in no admin email/username allowlist would pass that
 * helper while failing `requireAdmin` everywhere else. Adding it here would make
 * this test green by widening what counts as "protected" rather than by making
 * the route protected, which is exactly the failure mode this guard exists to
 * catch. `app/api/admin/decision-os/telemetry/route.ts` was reconciled by
 * calling `requireAdmin()` and keeping that helper as an ADDITIONAL narrowing.
 */

const RECOGNIZED_GATES = [
  "requireAdmin(",
  "requireAdminOrBearer(",
  "getAdminAccessState(",
] as const

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

/** Removes block comments and whole-line `//` comments so prose cannot satisfy a gate check. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

describe("admin API server-side protection", () => {
  it("keeps every /api/admin route behind an explicit server gate", () => {
    const adminApiRoutes = routeFiles("app/api/admin")

    // Sanity floor: if discovery silently returned nothing, an empty offender
    // list would be a false green rather than a real pass.
    expect(adminApiRoutes.length).toBeGreaterThan(0)

    const offenders: string[] = []

    for (const route of adminApiRoutes) {
      const code = stripComments(read(route))

      const matchedGate = RECOGNIZED_GATES.find((gate) => code.includes(gate))

      // The bootstrap route is intentionally credential-gated rather than
      // admin-session gated — it is how the first admin is created, before any
      // admin exists to authenticate as. It must still be env-gated AND
      // password-gated, and it 404s when disabled.
      const hasBootstrapGate =
        route.includes("/bootstrap/") &&
        code.includes("ADMIN_BOOTSTRAP_ENABLED") &&
        code.includes("ADMIN_BOOTSTRAP_PASSWORD")

      if (!matchedGate && !hasBootstrapGate) {
        offenders.push(route)
      }
    }

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `${offenders.length} /api/admin route(s) are not behind a recognized server-side admin gate ` +
          `(${RECOGNIZED_GATES.join(", ")}) or explicit bootstrap env+password gating:\n` +
          offenders.map((route) => `  - ${route}`).join("\n") +
          `\n\nFix the ROUTE, not this list. See the note above RECOGNIZED_GATES before adding a helper to it.`,
    ).toEqual([])
  })
})
