import { describe, expect, it } from "vitest"
import {
  hasAiAccess,
  hasAllFantasyTestAccess,
  hasChatAdminAccess,
  hasPoolAdminAccess,
  isAfCommissioner,
  isSiteAdmin,
} from "@/lib/auth/admin"

describe("central AllFantasy admin entitlements", () => {
  it("grants site admin access by email case-insensitively", () => {
    expect(isSiteAdmin({ email: "Cjabar.henson@gmail.com" })).toBe(true)
    expect(isSiteAdmin({ email: "cjabar.henson@gmail.com" })).toBe(true)
  })

  it("grants all-access test permissions by username (case-insensitive)", () => {
    for (const username of ["TheCiege26", "theciege26", "THECIEGE26", "tHeciEge26"]) {
      const user = { username }
      expect(hasAllFantasyTestAccess(user), `username: ${username}`).toBe(true)
      expect(isAfCommissioner(user), `isAfCommissioner: ${username}`).toBe(true)
      expect(hasAiAccess(user), `hasAiAccess: ${username}`).toBe(true)
    }
  })

  it("does not grant admin, AI, commissioner, or pool access to a normal user", () => {
    const user = { email: "member@example.com", username: "normal-user" }

    expect(isSiteAdmin(user)).toBe(false)
    expect(hasAllFantasyTestAccess(user)).toBe(false)
    expect(isAfCommissioner(user)).toBe(false)
    expect(hasAiAccess(user)).toBe(false)
    expect(hasPoolAdminAccess(user)).toBe(false)
    expect(hasChatAdminAccess(user)).toBe(false)
  })
})
