// @vitest-environment node
/**
 * Every middleware response carries the baseline browser security headers.
 * Before 2026-09-30 pages carried none of them: any page could be framed
 * (clickjacking) and nothing pinned browsers to HTTPS. Addresses are RFC 5737.
 *
 * Since 2026-11-13 the full script CSP is ENFORCED (lib/security/cspReportOnly.ts,
 * Phase 2), with CSP_MODE=report-only as the no-code rollback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn(async () => null) }))
vi.mock("@/lib/geo/geoIpFetch", () => ({ fetchIpApi: vi.fn(async () => null), fetchProxycheck: vi.fn(async () => null) }))

import { middleware } from "@/middleware"
import { CSP_ENFORCED_POLICY } from "@/lib/security/cspReportOnly"

const MINIMAL = "frame-ancestors 'none'; object-src 'none'; base-uri 'self'"

function from(path: string) {
  return new NextRequest(new URL(`https://www.allfantasy.ai${path}`), {
    headers: { "cf-ipcountry": "US", "cf-region-code": "TX", "cf-connecting-ip": "198.51.100.80" },
  })
}

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "test-nextauth-secret-not-a-real-credential"
})
afterEach(() => vi.unstubAllEnvs())

describe("baseline security headers", () => {
  it("ENFORCES the full script policy in production by default", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const res = await middleware(from("/"))
    const csp = res.headers.get("content-security-policy") ?? ""
    expect(csp).toBe(CSP_ENFORCED_POLICY)
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("report-uri /api/security/csp-report")
    // The default (nonce-report) also REPORTS the stricter nonce policy — never the same
    // allowlist twice, which would double every report.
    const reportOnly = res.headers.get("content-security-policy-report-only") ?? ""
    expect(reportOnly).not.toBe(CSP_ENFORCED_POLICY)
    expect(reportOnly).toMatch(/'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/)
  })

  it("CSP_MODE=enforce sends the allowlist alone", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("CSP_MODE", "enforce")
    const res = await middleware(from("/"))
    expect(res.headers.get("content-security-policy")).toBe(CSP_ENFORCED_POLICY)
    expect(res.headers.get("content-security-policy-report-only")).toBeNull()
  })

  it("CSP_MODE=report-only rolls back to the minimal enforced header plus the report-only policy", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("CSP_MODE", "report-only")
    const res = await middleware(from("/"))
    expect(res.headers.get("content-security-policy")).toBe(MINIMAL)
    expect(res.headers.get("content-security-policy-report-only")).toContain("script-src 'self'")
    expect(res.headers.get("content-security-policy-report-only")).toContain("report-uri /api/security/csp-report")
  })

  it("keeps only the minimal header in development (HMR evals module code)", async () => {
    vi.stubEnv("NODE_ENV", "development")
    const res = await middleware(from("/api/health"))
    expect(res.headers.get("content-security-policy")).toBe(MINIMAL)
    expect(res.headers.get("content-security-policy-report-only")).toBeNull()
    expect(res.headers.get("x-frame-options")).toBe("DENY")
  })

  it.each(["/", "/login", "/blog", "/api/health"])("are set on %s", async (path) => {
    vi.stubEnv("NODE_ENV", "production")
    const res = await middleware(from(path))
    expect(res.headers.get("x-frame-options")).toBe("DENY")
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'")
    // No report-to: with it present Chrome ignores report-uri (see cspReportOnly.ts).
    expect(res.headers.get("content-security-policy")).not.toContain("report-to")
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin")
    expect(res.headers.get("permissions-policy")).toContain("camera=()")
    // Voice input needs the microphone on our own origin.
    expect(res.headers.get("permissions-policy")).toContain("microphone=(self)")
  })
})
