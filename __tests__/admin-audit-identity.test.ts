import { describe, expect, it } from "vitest"

import { resolveAdminAuditIdentity } from "@/lib/admin-audit-identity"

/**
 * Launch-hardening: honest admin attribution. A shared-password admin session has no
 * per-person identity — it must resolve to the fixed "password-admin" label (never a real
 * administrator's email, never the anonymous "unknown-admin"). Email / id / app-session
 * attribution must be unchanged.
 */
describe("resolveAdminAuditIdentity", () => {
  it("prefers a verified email over everything else", () => {
    expect(
      resolveAdminAuditIdentity({ email: "ops@example.com", id: "u1", name: "Ops", authMethod: "password" }),
    ).toBe("ops@example.com")
  })

  it("falls back to the authenticated user id when there is no email (app/bootstrap sessions)", () => {
    expect(resolveAdminAuditIdentity({ id: "user-123", authMethod: "password" })).toBe("user-123")
  })

  it("falls back to an explicit session name when there is no email or id", () => {
    expect(resolveAdminAuditIdentity({ name: "Release Bot" })).toBe("Release Bot")
  })

  it("records the honest 'password-admin' for a shared-password session — never an email", () => {
    const identity = resolveAdminAuditIdentity({ authMethod: "password" })
    expect(identity).toBe("password-admin")
    expect(identity).not.toContain("@")
  })

  it("does NOT read ADMIN_EMAILS for a password session (no named-admin impersonation)", () => {
    process.env.ADMIN_EMAILS = "founder@example.com,ops@example.com"
    try {
      const identity = resolveAdminAuditIdentity({ authMethod: "password" })
      expect(identity).toBe("password-admin")
      expect(identity).not.toBe("founder@example.com")
    } finally {
      delete process.env.ADMIN_EMAILS
    }
  })

  it("returns 'unknown-admin' ONLY for a genuinely identity-less / legacy session", () => {
    // A legacy password cookie signed before authMethod existed carries none of these.
    expect(resolveAdminAuditIdentity({})).toBe("unknown-admin")
    expect(resolveAdminAuditIdentity({ authMethod: undefined })).toBe("unknown-admin")
    expect(resolveAdminAuditIdentity(null)).toBe("unknown-admin")
    expect(resolveAdminAuditIdentity(undefined)).toBe("unknown-admin")
  })

  it("ignores blank / whitespace-only identity fields", () => {
    expect(resolveAdminAuditIdentity({ email: "   ", id: "  ", name: " ", authMethod: "password" })).toBe(
      "password-admin",
    )
  })
})
