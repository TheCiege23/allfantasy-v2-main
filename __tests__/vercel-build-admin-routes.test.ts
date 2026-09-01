import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * 🛑 THIS FILE ASSERTED SOMETHING FALSE FOR MONTHS, AND THAT IS THE FINDING.
 *
 * It used to require that `scripts/vercel-next-build.cjs` never contain
 * `path.join('app', 'api', 'admin')`. `43f9ae44c` (route-budget cleanup) added exactly that line
 * on purpose — Vercel had hit the 2048-route cap at 2049 — and this test has been red on `main`
 * ever since, contradicting the deliberate design rather than protecting anything.
 *
 * A permanently-red guard is the mirror of the permanently-green one CLAUDE.md is full of: nobody
 * reads either, and both feel like coverage. So this now asserts what actually keeps an admin
 * route alive.
 *
 * ⚠ THE MECHANISM CHANGED, NOT THE INTENT. `app/api/admin` is excluded WHOLESALE, and individual
 * routes are restored by name in `filesToKeep`. So the property worth guarding is no longer
 * "the directory is not excluded" — it is "every keep-line still points at a file that exists".
 * A keep-line that has drifted from its route (renamed, moved, deleted) silently restores nothing:
 * the route 404s in production and every local check stays green, because the build script only
 * ever runs on Vercel.
 */
const source = readFileSync(path.join(process.cwd(), "scripts", "vercel-next-build.cjs"), "utf8")

/** Keep-lines are the only `path.join(…)` under app/api/admin that name a route file. */
function adminKeepLines(): string[] {
  const out: string[] = []
  for (const m of source.matchAll(/path\.join\(([^)]*)\)/g)) {
    const segs = [...m[1]!.matchAll(/'([^']*)'/g)].map((s) => s[1]!)
    if (segs[0] === "app" && segs[1] === "api" && segs[2] === "admin" && segs.at(-1) === "route.ts") {
      out.push(segs.join("/"))
    }
  }
  return out
}

describe("Vercel build route exclusions", () => {
  it("does not exclude the admin command center UI", () => {
    // Trailing comma on purpose: it matches an EXCLUSION entry and not a keep-line prefix.
    expect(source).not.toContain("path.join('app', 'admin'),")
  })

  it("keeps admin API routes by name once the directory is excluded wholesale", () => {
    const excludedWholesale = source.includes("path.join('app', 'api', 'admin'),")
    const keeps = adminKeepLines()
    // If the exclusion is ever lifted the keep list becomes redundant, not wrong — so this is
    // conditional rather than an assertion that the exclusion must exist.
    if (excludedWholesale) expect(keeps.length).toBeGreaterThan(0)
  })

  it("every admin keep-line points at a route file that exists", () => {
    const missing = adminKeepLines().filter(
      (rel) => !existsSync(path.join(process.cwd(), ...rel.split("/"))),
    )
    // Name them: "expected 1 to be 0" would not tell the next reader which route is now a 404.
    expect(missing).toEqual([])
  })

  it("keeps the Decision OS grounding proof surface (5.1)", () => {
    // Without this line the route ships as a 404 and the only tool for reading what Chimmy is
    // actually grounded on is silently not there.
    expect(adminKeepLines()).toContain("app/api/admin/decision-os/grounding-proof/route.ts")
  })
})
