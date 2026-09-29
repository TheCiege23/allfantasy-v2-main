/**
 * Trade route inventory ratchet — AF_TRADE_UNIFICATION_BRIEF Phase 0.
 *
 * The no-auth raw engine route app/api/engine/trade/analyze was deleted and
 * replaced by the authenticated app/api/trades/analyze (itself removed as
 * dead code on 2026-09-29: nothing called it or its /api/app analyze-ai
 * proxies). This test keeps the
 * deleted route from coming back and prevents NEW routes from growing under
 * app/api/engine/trade/.
 *
 * Phase 0.5 update: app/api/engine/trade/simulate-counter/route.ts (the second
 * no-auth engine route found during Phase 0) is now AUTH-GATED in place —
 * session (401) + rate limit (429) + league membership when league-scoped
 * (403). It stays in the location allowlist because the file still lives under
 * app/api/engine/trade/, but this test now also asserts its auth wiring so it
 * can never silently regress to unauthenticated. Do NOT add entries to the
 * allowlist — shrink it (final state: empty, route relocated/unified in
 * Phase 4).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const ENGINE_TRADE_DIR = "app/api/engine/trade"

/**
 * Routes under app/api/engine/trade/ that may exist ONLY in auth-gated form
 * (enforced below). Shrink only.
 */
const ALLOWLISTED_REMAINING_ROUTES = new Set([
  "app/api/engine/trade/simulate-counter/route.ts",
])

function routeFiles(dir: string): string[] {
  const absolute = resolve(process.cwd(), dir)
  if (!existsSync(absolute)) return []
  return readdirSync(absolute).flatMap((entry) => {
    const rel = `${dir}/${entry}`.replaceAll("\\", "/")
    const full = resolve(process.cwd(), rel)
    if (statSync(full).isDirectory()) return routeFiles(rel)
    return /^route\.(ts|tsx|js|jsx)$/.test(entry) ? [rel] : []
  })
}

describe("trade route inventory (Phase 0 ratchet)", () => {
  it("the deleted no-auth route app/api/engine/trade/analyze never comes back", () => {
    const analyzeRoutes = routeFiles(`${ENGINE_TRADE_DIR}/analyze`)
    expect(
      analyzeRoutes,
      "app/api/engine/trade/analyze was deleted in Phase 0 (no session, no rate limit). " +
        "Reach the trade engine through an authenticated surface instead.",
    ).toEqual([])
  })

  it("no new route files appear under app/api/engine/trade/", () => {
    const remaining = routeFiles(ENGINE_TRADE_DIR).filter(
      (route) => !ALLOWLISTED_REMAINING_ROUTES.has(route),
    )
    expect(
      remaining,
      "New routes under app/api/engine/trade/ are forbidden. The raw trade engine must only be " +
        "reached through authenticated surfaces (see AF_TRADE_UNIFICATION_BRIEF.md). " +
        "If you are removing an allowlisted route, delete its entry above too.",
    ).toEqual([])
  })

  it("every allowlisted engine/trade route is auth-gated (Phase 0.5)", () => {
    for (const route of ALLOWLISTED_REMAINING_ROUTES) {
      const absolute = resolve(process.cwd(), route)
      expect(
        existsSync(absolute),
        `${route} is allowlisted but missing — if it was deleted, remove its allowlist entry.`,
      ).toBe(true)
      const source = readFileSync(absolute, "utf8")
      for (const marker of ["getServerSession", "assertLeagueMember", "rateLimit"]) {
        expect(
          source.includes(marker),
          `${route} must stay auth-gated: expected source to reference ${marker}. ` +
            "Unauthenticated engine routes were removed in Phase 0/0.5 of AF_TRADE_UNIFICATION_BRIEF.md.",
        ).toBe(true)
      }
    }
  })

})
