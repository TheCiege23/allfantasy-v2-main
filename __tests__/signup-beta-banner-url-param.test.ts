/**
 * The signup page must not take closed-beta messaging from a URL parameter.
 *
 * `/signup` rendered its refusal purely from `?betaError=`, with no check that a beta was
 * running. After signup reopened the server could no longer produce those codes, but any
 * URL still carrying one — stale tab, bookmark, back button, a link someone shared —
 * kept showing "AllFantasy is in a closed beta" as a red alert over a form that worked.
 * A query parameter is a claim from the client, never authority about server policy.
 *
 * Source assertions: the bug is a missing guard, which is what these check.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { CLOSED_BETA_ENABLED } from "@/lib/beta-invite/closedBetaFlag"

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8")
}

const signup = read("app/signup/SignupContent.tsx")
const flag = read("lib/beta-invite/closedBetaFlag.ts")
const service = read("lib/beta-invite/betaAdmissionService.ts")

describe("the shared closed-beta switch", () => {
  it("is off — signup is open", () => {
    expect(CLOSED_BETA_ENABLED).toBe(false)
  })

  it("is client-importable: the flag module does not IMPORT server-only", () => {
    // With a `server-only` import here the signup page could not read it, which is how the
    // two sides drifted in the first place. Match the import statement, not the words —
    // the doc comment legitimately mentions server-only when explaining why.
    expect(flag).not.toMatch(/^\s*import\s+["']server-only["']/m)
  })

  it("is the ONE source — the service imports it rather than redeclaring it", () => {
    expect(service).toContain('from "@/lib/beta-invite/closedBetaFlag"')
    expect(service).not.toMatch(/const\s+CLOSED_BETA_ENABLED\s*=/)
  })
})

describe("signup ignores the beta URL params while signup is open", () => {
  it("guards betaError behind the flag", () => {
    expect(signup).toMatch(/CLOSED_BETA_ENABLED[\s\S]{0,120}betaError/)
  })

  it("guards beta=1 behind the flag", () => {
    expect(signup).toMatch(/CLOSED_BETA_ENABLED\s*&&\s*searchParams\?\.get\("beta"\)/)
  })

  it("never derives the banner from the raw param alone", () => {
    // The original line: `searchParams?.get("betaError")?.trim() || undefined` with no guard.
    expect(signup).not.toMatch(
      /const betaErrorCode = searchParams\?\.get\("betaError"\)\?\.trim\(\) \|\| undefined/,
    )
    expect(signup).not.toMatch(/const betaMode = searchParams\?\.get\("beta"\) === "1"/)
  })
})
