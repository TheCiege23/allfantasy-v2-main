import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { getDeploymentLinkOrigin } from "@/lib/site-public-origin"

/**
 * P0-1 preview-host correctness. Fixes the admin magic link so a link requested on a
 * PREVIEW deployment returns to the SAME preview (not production), without ever trusting
 * the request Host header (no spoofing).
 *
 * Note on the reported "redirect": the preview's /admin-login does NOT server-redirect —
 * `canonicalProductionHostRedirect` skips *.vercel.app hosts (asserted below), and
 * cafeconchimmy.vercel.app/admin-login is a 404. The address bar showed the registrable
 * domain because mobile Safari truncates long hosts. The real defect was the magic-link
 * origin, fixed by getDeploymentLinkOrigin.
 */

const PREVIEW_HOST = "allfantasy-v2-main-git-feat-launch-phase0-6ebf79-cafeconchimmy.vercel.app"
const DEPLOY_HOST = "allfantasy-v2-main-kg2tme18d-cafeconchimmy.vercel.app"

describe("getDeploymentLinkOrigin — preview returns to preview", () => {
  it("uses the stable branch alias on a preview deployment", () => {
    expect(
      getDeploymentLinkOrigin({
        VERCEL_ENV: "preview",
        VERCEL_BRANCH_URL: PREVIEW_HOST,
        VERCEL_URL: DEPLOY_HOST,
        PUBLIC_SITE_URL: "https://www.allfantasy.ai", // present but must NOT win on preview
      } as NodeJS.ProcessEnv),
    ).toBe(`https://${PREVIEW_HOST}`)
  })

  it("falls back to the per-deploy Vercel URL on preview when no branch alias is set", () => {
    expect(
      getDeploymentLinkOrigin({ VERCEL_ENV: "preview", VERCEL_URL: DEPLOY_HOST } as NodeJS.ProcessEnv),
    ).toBe(`https://${DEPLOY_HOST}`)
  })

  it("never sends a preview link to the production canonical host", () => {
    const origin = getDeploymentLinkOrigin({
      VERCEL_ENV: "preview",
      VERCEL_BRANCH_URL: PREVIEW_HOST,
      PUBLIC_SITE_URL: "https://cafeconchimmy.vercel.app",
      NEXT_PUBLIC_SITE_URL: "https://www.allfantasy.ai",
    } as NodeJS.ProcessEnv)
    expect(origin).toBe(`https://${PREVIEW_HOST}`)
    expect(origin).not.toContain("cafeconchimmy.vercel.app/") // not the bare registrable domain
    expect(origin).not.toContain("www.allfantasy.ai")
  })
})

describe("getDeploymentLinkOrigin — production unchanged", () => {
  it("uses the configured canonical origin in production", () => {
    expect(
      getDeploymentLinkOrigin({
        VERCEL_ENV: "production",
        PUBLIC_SITE_URL: "https://www.allfantasy.ai",
        VERCEL_URL: DEPLOY_HOST, // present but must NOT win in production
      } as NodeJS.ProcessEnv),
    ).toBe("https://www.allfantasy.ai")
  })

  it("falls back to NEXT_PUBLIC_SITE_URL when PUBLIC_SITE_URL is unset", () => {
    expect(
      getDeploymentLinkOrigin({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SITE_URL: "https://www.allfantasy.ai",
      } as NodeJS.ProcessEnv),
    ).toBe("https://www.allfantasy.ai")
  })
})

describe("getDeploymentLinkOrigin — spoof-safe & fallbacks", () => {
  it("reads ONLY env — a Host/X-Forwarded-Host header can never influence it", () => {
    // The function signature accepts only an env object; there is no header input at all.
    // A production env with a hostile PUBLIC_SITE_URL would be a misconfiguration, not a
    // spoof — the point is that request headers are structurally out of scope here.
    const origin = getDeploymentLinkOrigin({
      VERCEL_ENV: "production",
      PUBLIC_SITE_URL: "https://www.allfantasy.ai",
    } as NodeJS.ProcessEnv)
    expect(origin).toBe("https://www.allfantasy.ai")
  })

  it("returns a relative-fallback empty string when nothing is configured (local dev)", () => {
    expect(getDeploymentLinkOrigin({} as NodeJS.ProcessEnv)).toBe("")
  })
})

// ── Source-assertion invariants (the modules are heavy to import) ─────────────────────
function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8")
}

describe("middleware never redirects a preview off its own origin", () => {
  const mw = read("middleware.ts")
  it("canonical-host redirect skips *.vercel.app (so preview /admin-login is not redirected to production)", () => {
    expect(mw).toMatch(/host\.endsWith\("\.vercel\.app"\)\s*\)\s*return null/)
  })
  it("the only absolute-host redirect targets the configured canonical host (production apex→www preserved)", () => {
    expect(mw).toContain("getPublicSiteHostname()")
    expect(mw).toMatch(/url\.hostname = canonicalHost/)
    expect(mw).toContain("NextResponse.redirect(url, 308)")
  })
})

describe("admin magic link uses the preview-aware origin, and post-auth stays on-origin", () => {
  const request = read("app/api/auth/admin-magic/request/route.ts")
  const consume = read("app/api/auth/admin-magic/consume/route.ts")

  it("request route builds the link from getDeploymentLinkOrigin, not the old fixed env chain", () => {
    expect(request).toContain("getDeploymentLinkOrigin()")
    expect(request).not.toContain('process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || ""')
  })

  it("consume redirects to a sanitized RELATIVE next on the request origin (stays on the preview)", () => {
    // new URL(next, url) with next sanitized to an /admin path keeps the redirect on the
    // same origin the magic link was on — so a preview link lands on the preview /admin.
    expect(consume).toMatch(/new URL\(next, url\)/)
    expect(consume).toContain("sanitizeNext")
  })

  it("consume sanitizeNext blocks open-redirects (protocol-relative and non-/admin paths)", () => {
    // "//evil.com" and "https://evil.com" both collapse to "/admin".
    expect(consume).toMatch(/startsWith\("\/\/"\)/)
    expect(consume).toMatch(/startsWith\("\/admin"\)/)
  })
})
