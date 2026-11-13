// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ findUnique: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { appUser: { findUnique: h.findUnique } } }))

const ADMIN = "boss@allfantasy.test"
const saved = process.env.ADMIN_EMAILS
process.env.ADMIN_EMAILS = ADMIN
afterAll(() => {
  if (saved === undefined) delete process.env.ADMIN_EMAILS
  else process.env.ADMIN_EMAILS = saved
})

import { provenPrivilegedEmail } from "@/lib/auth/provenPrivilegedEmail"
import { EntitlementResolver } from "@/lib/subscription/EntitlementResolver"

describe("provenPrivilegedEmail", () => {
  beforeEach(() => {
    h.findUnique.mockReset()
  })

  it("passes an ordinary email through without touching the database", async () => {
    expect(await provenPrivilegedEmail("u1", "someone@example.com")).toBe("someone@example.com")
    expect(h.findUnique).not.toHaveBeenCalled()
  })

  it("drops an allowlisted email this account has not verified", async () => {
    h.findUnique.mockResolvedValue({ email: ADMIN, emailVerified: null })
    expect(await provenPrivilegedEmail("attacker", ADMIN)).toBeNull()
  })

  it("drops an allowlisted email that belongs to a DIFFERENT row", async () => {
    h.findUnique.mockResolvedValue({ email: "attacker@example.com", emailVerified: new Date() })
    expect(await provenPrivilegedEmail("attacker", ADMIN)).toBeNull()
  })

  it("keeps an allowlisted email the account has verified", async () => {
    h.findUnique.mockResolvedValue({ email: ADMIN, emailVerified: new Date() })
    expect(await provenPrivilegedEmail("boss", ADMIN)).toBe(ADMIN)
  })

  it("fails closed when the read fails", async () => {
    h.findUnique.mockRejectedValue(new Error("db down"))
    expect(await provenPrivilegedEmail("boss", ADMIN)).toBeNull()
  })
})

describe("EntitlementResolver does not grant the admin bypass to an unproven address", () => {
  it("an unverified allowlisted email gets no dev-admin snapshot", async () => {
    h.findUnique.mockResolvedValue({ email: ADMIN, emailVerified: null })
    const resolver = new EntitlementResolver()
    const snapshot = await resolver.resolveSnapshot("attacker", ADMIN).catch(() => null)
    // Whatever the non-bypass path yields here, it must not be the all-plans bypass.
    const { buildDevAdminEntitlementSnapshot } = await import("@/lib/dev-admin/access")
    expect(snapshot).not.toEqual(buildDevAdminEntitlementSnapshot())
  })

  it("a verified allowlisted email still gets it", async () => {
    h.findUnique.mockResolvedValue({ email: ADMIN, emailVerified: new Date() })
    const resolver = new EntitlementResolver()
    const snapshot = await resolver.resolveSnapshot("boss", ADMIN)
    const { buildDevAdminEntitlementSnapshot } = await import("@/lib/dev-admin/access")
    expect(snapshot).toEqual(buildDevAdminEntitlementSnapshot())
  })
})
