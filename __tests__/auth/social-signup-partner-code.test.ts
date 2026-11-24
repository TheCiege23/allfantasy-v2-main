/**
 * Commissioner Partner Codes for Apple and Google sign-ups (2026-11-24). A new social account is
 * created in linkSocialAccountToAppUser, never in /api/auth/register, so this is where the
 * `af_partner_code` cookie (from /with/CODE, or a code typed on /signup and saved by
 * /api/partner-codes/remember) has to attach. Setup copied from beta-gate-oauth-behavior.test.ts.
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
  partnerCookie: { value: null as string | null },
  attachReferral: vi.fn(),
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
      get: (name: string) =>
        name === "af_beta_admission"
          ? { value: mocks.admissionCookie.value }
          : name === "af_partner_code" && mocks.partnerCookie.value
            ? { value: mocks.partnerCookie.value }
            : undefined,
    }),
  headers: () => Promise.resolve(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })),
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/partner-codes/service", () => ({ attachReferral: mocks.attachReferral }))

import { linkSocialAccountToAppUser } from "@/lib/auth/SocialAccountLinkingService"

const NEW_USER = {
  id: "new-user-1",
  email: "invitee@example.com",
  username: "invitee",
  displayName: "Invitee",
  avatarUrl: null,
  emailVerified: new Date(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isInviteOnlyEnabled.mockReturnValue(false) // open signup, as shipped
  mocks.partnerCookie.value = null
  mocks.attachReferral.mockResolvedValue({ ok: true })
  vi.stubEnv("PARTNER_CODES_ENABLED", "1")
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
  vi.unstubAllEnvs()
})

const signUp = () =>
  linkSocialAccountToAppUser({ provider: "apple", providerAccountId: "a-1", email: "invitee@example.com", emailVerified: true })

describe("a new Apple or Google account carries its partner code", () => {
  it("attaches the cookie's code to the account it just created, with the visitor's IP", async () => {
    mocks.partnerCookie.value = "TheCiege"
    const user = await signUp()
    expect(user.id).toBe(NEW_USER.id)
    expect(mocks.attachReferral).toHaveBeenCalledWith({
      userId: NEW_USER.id,
      rawCode: "TheCiege",
      email: NEW_USER.email,
      ip: "203.0.113.9",
    })
  })

  it("does nothing without a code", async () => {
    await signUp()
    expect(mocks.attachReferral).not.toHaveBeenCalled()
  })

  it("never re-attributes a RETURNING login", async () => {
    mocks.partnerCookie.value = "TheCiege"
    mocks.appUserFindFirst.mockResolvedValue(NEW_USER) // an account with this email already exists
    await signUp()
    expect(mocks.appUserCreate).not.toHaveBeenCalled()
    expect(mocks.attachReferral).not.toHaveBeenCalled()
  })

  it("does nothing while the program is off", async () => {
    vi.stubEnv("PARTNER_CODES_ENABLED", "0")
    mocks.partnerCookie.value = "TheCiege"
    await signUp()
    expect(mocks.attachReferral).not.toHaveBeenCalled()
  })

  it("a failed attach never blocks the sign-in", async () => {
    mocks.partnerCookie.value = "TheCiege"
    mocks.attachReferral.mockRejectedValue(new Error("db down"))
    vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(signUp()).resolves.toMatchObject({ id: NEW_USER.id })
  })
})
