/**
 * P0-1 BETA-GATE — behavioral coverage of the OAuth new-account admission seam.
 *
 * Complements the source-assertion no-bypass test with real execution of
 * linkSocialAccountToAppUser's create branch: with the gate ACTIVE, a genuinely new OAuth
 * account is blocked without a matching invite, succeeds with one, and an email mismatch
 * is refused — while an existing-user resolution never consumes an invite.
 *
 * SIGNUP IS OPEN as shipped, so the gate is driven here by stubbing `isInviteOnlyEnabled`
 * rather than by setting INVITE_ONLY (which the service deliberately ignores now — see
 * betaAdmissionService). That keeps this closed-beta coverage alive and honest for whenever
 * CLOSED_BETA_ENABLED is flipped back on, and lets the last test assert the shipped
 * default: a brand-new OAuth user is created with no invite at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  authAccountFindFirst: vi.fn(),
  authAccountCreate: vi.fn(),
  authAccountUpdate: vi.fn(),
  appUserFindUnique: vi.fn(),
  appUserFindFirst: vi.fn(),
  appUserCreate: vi.fn(),
  appUserUpdate: vi.fn(),
  transaction: vi.fn(),
  betaFindUnique: vi.fn(),
  betaUpdateMany: vi.fn(),
  managerXPProfileUpsert: vi.fn(),
  ensureSharedAccountProfile: vi.fn(),
  hasProfanityInUsername: vi.fn(),
  getTierFromXP: vi.fn(),
  getXPRemainingToNextTier: vi.fn(),
  bcryptHash: vi.fn(),
  admissionCookie: { value: null as string | null },
  isInviteOnlyEnabled: vi.fn(),
}))

// Partial mock: every real admission primitive (hashing, validate, consume) runs unchanged;
// only the on/off switch is stubbed so a test can exercise the closed-beta branch.
vi.mock("@/lib/beta-invite/betaAdmissionService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/beta-invite/betaAdmissionService")>()),
  isInviteOnlyEnabled: mocks.isInviteOnlyEnabled,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    authAccount: {
      findFirst: mocks.authAccountFindFirst,
      create: mocks.authAccountCreate,
      update: mocks.authAccountUpdate,
    },
    appUser: {
      findUnique: mocks.appUserFindUnique,
      findFirst: mocks.appUserFindFirst,
      create: mocks.appUserCreate,
      update: mocks.appUserUpdate,
    },
    betaInvite: { findUnique: mocks.betaFindUnique, updateMany: mocks.betaUpdateMany },
    managerXPProfile: { upsert: mocks.managerXPProfileUpsert },
    $transaction: mocks.transaction,
  },
}))
vi.mock("@/lib/auth/SharedAccountBootstrapService", () => ({ ensureSharedAccountProfile: mocks.ensureSharedAccountProfile }))
vi.mock("@/lib/signup/UsernameProfanityGuard", () => ({ hasProfanityInUsername: mocks.hasProfanityInUsername }))
vi.mock("@/lib/xp-progression/TierResolver", () => ({
  getTierFromXP: mocks.getTierFromXP,
  getXPRemainingToNextTier: mocks.getXPRemainingToNextTier,
}))
vi.mock("bcryptjs", () => ({ default: { hash: mocks.bcryptHash }, hash: mocks.bcryptHash }))
// The service reads the admission token via `await import("next/headers")`.
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (name === "af_beta_admission" ? { value: mocks.admissionCookie.value } : undefined),
    }),
}))

import { hashToken } from "@/lib/beta-invite/betaAdmissionService"
import { linkSocialAccountToAppUser } from "@/lib/auth/SocialAccountLinkingService"

const NEW_USER = {
  id: "new-user-1",
  email: "invitee@example.com",
  username: "invitee",
  displayName: "Invitee",
  avatarUrl: null,
  emailVerified: new Date(),
}
const RAW = "oauth-admission-token-abcdefgh"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isInviteOnlyEnabled.mockReturnValue(true) // exercise the closed-beta branch
  mocks.admissionCookie.value = null
  mocks.hasProfanityInUsername.mockReturnValue(false)
  mocks.getTierFromXP.mockReturnValue("bronze")
  mocks.getXPRemainingToNextTier.mockReturnValue(100)
  mocks.managerXPProfileUpsert.mockResolvedValue({})
  mocks.ensureSharedAccountProfile.mockResolvedValue({})
  mocks.bcryptHash.mockResolvedValue("hashed")
  // No existing account anywhere → the genuinely-new create branch.
  mocks.authAccountFindFirst.mockResolvedValue(null)
  mocks.appUserFindFirst.mockResolvedValue(null)
  mocks.appUserFindUnique.mockResolvedValue(null)
  mocks.authAccountCreate.mockResolvedValue({})
  mocks.appUserUpdate.mockResolvedValue(NEW_USER)
  mocks.appUserCreate.mockResolvedValue(NEW_USER)
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      appUser: { create: mocks.appUserCreate },
      betaInvite: { findUnique: mocks.betaFindUnique, updateMany: mocks.betaUpdateMany },
    }),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

function pendingInviteFor(email: string) {
  return { id: "inv-1", invitedEmail: email, status: "pending", expiresAt: null }
}

describe("OAuth new-account admission when the closed-beta gate is ACTIVE", () => {
  it("BLOCKS a new OAuth account with no admission token", async () => {
    mocks.admissionCookie.value = null
    await expect(
      linkSocialAccountToAppUser({ provider: "google", providerAccountId: "g-1", email: "invitee@example.com", emailVerified: true }),
    ).rejects.toThrow(/BETA_INVITE_INVITE_REQUIRED/)
    expect(mocks.appUserCreate).not.toHaveBeenCalled()
  })

  it("CREATES a new OAuth account with a matching, valid invite (and consumes it)", async () => {
    mocks.admissionCookie.value = RAW
    mocks.betaFindUnique.mockResolvedValue(pendingInviteFor("invitee@example.com"))
    mocks.betaUpdateMany.mockResolvedValue({ count: 1 })

    const result = await linkSocialAccountToAppUser({
      provider: "google",
      providerAccountId: "g-2",
      email: "INVITEE@example.com", // case-insensitive match
      emailVerified: true,
    })

    expect(result.id).toBe(NEW_USER.id)
    expect(mocks.appUserCreate).toHaveBeenCalledTimes(1)
    // Consumed by digest, single-use guard, bound to the new user.
    expect(mocks.betaUpdateMany.mock.calls[0][0].where).toMatchObject({
      tokenDigest: hashToken(RAW),
      status: "pending",
    })
    expect(mocks.betaUpdateMany.mock.calls[0][0].data.redeemedByUserId).toBe(NEW_USER.id)
  })

  it("REFUSES a new OAuth account whose email does not match the invite", async () => {
    mocks.admissionCookie.value = RAW
    mocks.betaFindUnique.mockResolvedValue(pendingInviteFor("someone-else@example.com"))

    await expect(
      linkSocialAccountToAppUser({ provider: "discord", providerAccountId: "d-1", email: "invitee@example.com", emailVerified: true }),
    ).rejects.toThrow(/BETA_INVITE_INVITE_EMAIL_MISMATCH/)
    expect(mocks.appUserCreate).not.toHaveBeenCalled()
    expect(mocks.betaUpdateMany).not.toHaveBeenCalled()
  })

  it("does NOT consume an invite when resolving to an EXISTING account", async () => {
    // Existing user found by verified email → link path, create branch never entered.
    mocks.appUserFindFirst.mockResolvedValue(NEW_USER)
    mocks.admissionCookie.value = RAW

    const result = await linkSocialAccountToAppUser({
      provider: "google",
      providerAccountId: "g-3",
      email: "invitee@example.com",
      emailVerified: true,
    })

    expect(result.id).toBe(NEW_USER.id)
    expect(mocks.appUserCreate).not.toHaveBeenCalled()
    expect(mocks.betaUpdateMany).not.toHaveBeenCalled() // invite untouched
  })

  // The SHIPPED default. isInviteOnlyEnabled is false in production, so this is the path a
  // real new user takes: OAuth signup with no invite, no admission cookie, no invite lookup.
  it("creates a new OAuth account with no invite when the gate is off (open signup)", async () => {
    mocks.isInviteOnlyEnabled.mockReturnValue(false)
    mocks.admissionCookie.value = null

    const result = await linkSocialAccountToAppUser({
      provider: "google",
      providerAccountId: "g-4",
      email: "invitee@example.com",
      emailVerified: true,
    })

    expect(result.id).toBe(NEW_USER.id)
    expect(mocks.appUserCreate).toHaveBeenCalledTimes(1)
    expect(mocks.betaFindUnique).not.toHaveBeenCalled()
  })
})
