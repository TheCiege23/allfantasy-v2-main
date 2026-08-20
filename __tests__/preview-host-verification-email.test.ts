import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * P0-1 preview-host correctness for the SIGNUP verification email (sibling of the admin
 * magic-link fix in preview-host-admin-magic.test.ts).
 *
 * Bug: the signup + resend verification emails built their link from USER_FACING_SITE_ORIGIN,
 * which is always the production canonical (getPublicSiteOrigin, resolved at module load, docs:
 * "Avoids Vercel preview URLs in user inboxes"). So a PREVIEW signup emailed an allfantasy.ai
 * link, but the user + token exist only in the isolated preview DB → production can't resolve
 * them. Fix: build the link from getDeploymentLinkOrigin() (preview → preview host; production →
 * configured canonical; spoof-safe, env-only) with the canonical as a fallback.
 *
 * getDeploymentLinkOrigin's behavior is covered by preview-host-admin-magic.test.ts; here we pin
 * that BOTH verification-email routes use it, and that the invalid-token path degrades safely.
 */
function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8")
}

describe("signup verification email links back to the deployment that issued the token", () => {
  const register = read("app/api/auth/register/route.ts")
  const resend = read("app/api/auth/verify-email/send/route.ts")

  for (const [name, src] of [
    ["register", register],
    ["resend", resend],
  ] as const) {
    it(`${name} route builds the verify link from getDeploymentLinkOrigin (not the raw production origin)`, () => {
      expect(src).toContain("getDeploymentLinkOrigin()")
      // The link is built from the preview-aware origin…
      expect(src).toMatch(/const emailOrigin = getDeploymentLinkOrigin\(\) \|\| USER_FACING_SITE_ORIGIN/)
      expect(src).toContain("`${emailOrigin}/verify/email?token=")
      // …and NOT directly from the production-only constant.
      expect(src).not.toContain("`${USER_FACING_SITE_ORIGIN}/verify/email?token=")
    })

    it(`${name} route keeps the canonical fallback so production/local links are unchanged`, () => {
      // Fallback preserves production behavior (getDeploymentLinkOrigin returns the canonical
      // in production anyway) and avoids a relative link when nothing is configured (local).
      expect(src).toContain("|| USER_FACING_SITE_ORIGIN")
    })
  }
})

describe("verify/email degrades safely for tokens it cannot resolve (#14, no server crash)", () => {
  const consume = read("app/verify/email/route.ts")

  it("an unknown/absent token redirects to the invalid-link screen instead of throwing", () => {
    // findUnique is guarded and a missing row redirects to /verify?error=INVALID_LINK.
    expect(consume).toMatch(/\.catch\(\(\) => null\)/)
    expect(consume).toMatch(/INVALID_LINK/)
    expect(consume).toMatch(/EXPIRED_LINK/)
  })

  it("wraps the verify transaction so a failure redirects rather than 500s", () => {
    expect(consume).toMatch(/catch \(txErr\)/)
    expect(consume).toMatch(/redirectTo\(req, "\/verify\?error=INVALID_LINK"/)
  })
})
