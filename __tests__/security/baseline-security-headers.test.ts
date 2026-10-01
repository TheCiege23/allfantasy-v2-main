// @vitest-environment node
/**
 * Every middleware response carries the baseline browser security headers.
 * Before 2026-09-30 pages carried none of them: any page could be framed
 * (clickjacking) and nothing pinned browsers to HTTPS. Addresses are RFC 5737.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn(async () => null) }))
vi.mock("@/lib/geo/geoIpFetch", () => ({ fetchIpApi: vi.fn(async () => null), fetchProxycheck: vi.fn(async () => null) }))

import { middleware } from "@/middleware"

function from(path: string) {
  return new NextRequest(new URL(`https://www.allfantasy.ai${path}`), {
    headers: { "cf-ipcountry": "US", "cf-region-code": "TX", "cf-connecting-ip": "198.51.100.80" },
  })
}

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "test-nextauth-secret-not-a-real-credential"
})

describe("baseline security headers", () => {
  it.each(["/", "/login", "/blog", "/api/health"])("are set on %s", async (path) => {
    const res = await middleware(from(path))
    expect(res.headers.get("x-frame-options")).toBe("DENY")
    expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'none'")
    // The script-restricting policy ships REPORT-ONLY (lib/security/cspReportOnly.ts).
    expect(res.headers.get("content-security-policy-report-only")).toContain("script-src 'self'")
    expect(res.headers.get("content-security-policy-report-only")).toContain("report-uri /api/security/csp-report")
    // No report-to: with it present Chrome ignores report-uri (see cspReportOnly.ts).
    expect(res.headers.get("content-security-policy-report-only")).not.toContain("report-to")
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin")
    expect(res.headers.get("permissions-policy")).toContain("camera=()")
    // Voice input needs the microphone on our own origin.
    expect(res.headers.get("permissions-policy")).toContain("microphone=(self)")
  })
})
