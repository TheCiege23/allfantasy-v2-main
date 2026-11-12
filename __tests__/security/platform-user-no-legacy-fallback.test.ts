import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getUserSessionFromCookie: vi.fn(),
  appUserFindFirst: vi.fn(),
}))

vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/api-auth", () => ({ getUserSessionFromCookie: h.getUserSessionFromCookie }))
vi.mock("@/lib/prisma", () => ({ prisma: { appUser: { findFirst: h.appUserFindFirst } } }))

import { resolvePlatformUser } from "@/lib/platform/current-user"

describe("resolvePlatformUser — a Sleeper handle is not an identity", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // A victim whose AllFantasy username equals the handle in the attacker's cookie.
    h.appUserFindFirst.mockResolvedValue({ id: "victim-user" })
  })

  it("never resolves an AppUser from af_session alone", async () => {
    h.getServerSession.mockResolvedValue(null)
    h.getUserSessionFromCookie.mockResolvedValue({ sleeperUsername: "victimname" })

    const result = await resolvePlatformUser()

    expect(result).toEqual({ appUserId: null, legacyUsername: "victimname" })
    expect(h.appUserFindFirst).not.toHaveBeenCalled()
  })

  it("uses the NextAuth session user when there is one", async () => {
    h.getServerSession.mockResolvedValue({ user: { id: "me" } })
    h.getUserSessionFromCookie.mockResolvedValue({ sleeperUsername: "victimname" })

    const result = await resolvePlatformUser()

    expect(result.appUserId).toBe("me")
  })
})
