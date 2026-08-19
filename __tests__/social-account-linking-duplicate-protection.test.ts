import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  authAccountFindFirst: vi.fn(),
  authAccountCreate: vi.fn(),
  authAccountUpdate: vi.fn(),
  appUserFindUnique: vi.fn(),
  appUserFindFirst: vi.fn(),
  appUserCreate: vi.fn(),
  appUserUpdate: vi.fn(),
  ensureSharedAccountProfile: vi.fn(),
  hasProfanityInUsername: vi.fn(),
  getTierFromXP: vi.fn(),
  getXPRemainingToNextTier: vi.fn(),
  managerXPProfileUpsert: vi.fn(),
  bcryptHash: vi.fn(),
  transaction: vi.fn(),
  betaFindUnique: vi.fn(),
  betaUpdateMany: vi.fn(),
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
    // P0-1 BETA-GATE: the OAuth create now runs inside a transaction. With INVITE_ONLY
    // unset (default here), the callback only calls tx.appUser.create — the gate is skipped.
    $transaction: mocks.transaction,
  },
}))

vi.mock("@/lib/auth/SharedAccountBootstrapService", () => ({
  ensureSharedAccountProfile: mocks.ensureSharedAccountProfile,
}))

vi.mock("@/lib/signup/UsernameProfanityGuard", () => ({
  hasProfanityInUsername: mocks.hasProfanityInUsername,
}))

vi.mock("@/lib/xp-progression/TierResolver", () => ({
  getTierFromXP: mocks.getTierFromXP,
  getXPRemainingToNextTier: mocks.getXPRemainingToNextTier,
}))

vi.mock("bcryptjs", () => ({
  default: { hash: mocks.bcryptHash },
  hash: mocks.bcryptHash,
}))

import { Prisma } from "@prisma/client"
import { linkSocialAccountToAppUser } from "@/lib/auth/SocialAccountLinkingService"

const EXISTING_USER = {
  id: "app-user-1",
  email: "shared@example.com",
  username: "shareduser",
  displayName: "Shared User",
  avatarUrl: null,
  emailVerified: new Date(),
}

describe("linkSocialAccountToAppUser — duplicate-account protections", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hasProfanityInUsername.mockReturnValue(false)
    mocks.getTierFromXP.mockReturnValue("bronze")
    mocks.getXPRemainingToNextTier.mockReturnValue(100)
    mocks.managerXPProfileUpsert.mockResolvedValue({})
    mocks.ensureSharedAccountProfile.mockResolvedValue({})
    mocks.bcryptHash.mockResolvedValue("hashed-placeholder")
    mocks.appUserUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...EXISTING_USER, ...data }))
    mocks.authAccountUpdate.mockResolvedValue({})
    // Run the create transaction by invoking the callback with a tx client backed by the
    // same appUser/betaInvite mocks, so behavior is identical to a bare create when the
    // gate is off (INVITE_ONLY unset).
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        appUser: { create: mocks.appUserCreate },
        betaInvite: { findUnique: mocks.betaFindUnique, updateMany: mocks.betaUpdateMany },
      }),
    )
  })

  it("Google then Discord with the same email resolves to the same AppUser", async () => {
    // Neither provider has an AuthAccount row yet; both fall back to the email lookup.
    mocks.authAccountFindFirst.mockResolvedValue(null)
    mocks.appUserFindFirst.mockResolvedValue(EXISTING_USER)
    mocks.authAccountCreate.mockResolvedValue({})

    const googleResult = await linkSocialAccountToAppUser({
      provider: "google",
      providerAccountId: "google-acct-1",
      email: "shared@example.com",
      // Both providers assert a VERIFIED email — that is what lets the email-match resolve
      // to the existing account instead of falling through to the create branch. Without
      // this the test never exercised the behavior its name describes (it deref'd undefined
      // in the create path). Repaired narrowly per the P0-1 audit.
      emailVerified: true,
    })
    const discordResult = await linkSocialAccountToAppUser({
      provider: "discord",
      providerAccountId: "discord-acct-1",
      email: "shared@example.com",
      emailVerified: true,
    })

    expect(googleResult.id).toBe(EXISTING_USER.id)
    expect(discordResult.id).toBe(EXISTING_USER.id)
    expect(mocks.appUserCreate).not.toHaveBeenCalled()
  })

  it("the same providerAccountId is found via AuthAccount lookup and never creates a second AppUser, even if the caller passes a different email", async () => {
    mocks.authAccountFindFirst.mockResolvedValue({ id: "auth-acct-1", userId: EXISTING_USER.id })
    mocks.appUserFindUnique.mockResolvedValue(EXISTING_USER)
    // A conflicting-email-owner check runs before any email update is applied.
    mocks.appUserFindFirst.mockResolvedValue({ id: "some-other-user" })

    const result = await linkSocialAccountToAppUser({
      provider: "google",
      providerAccountId: "google-acct-1",
      email: "attacker-supplied-different@example.com",
    })

    expect(result.id).toBe(EXISTING_USER.id)
    expect(mocks.appUserCreate).not.toHaveBeenCalled()
    // Email update must be skipped when it would collide with a different existing user.
    expect(mocks.appUserUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: "attacker-supplied-different@example.com" }) }))
  })

  it("a provider with no email and no existing linked account cannot create an unlinked AppUser", async () => {
    mocks.authAccountFindFirst.mockResolvedValue(null)

    await expect(
      linkSocialAccountToAppUser({
        provider: "google",
        providerAccountId: "google-acct-new",
        email: null,
      })
    ).rejects.toThrow("SOCIAL_PROVIDER_EMAIL_MISSING")

    expect(mocks.appUserCreate).not.toHaveBeenCalled()
    expect(mocks.authAccountCreate).not.toHaveBeenCalled()
  })

  it("recovers from a concurrent-create race on AuthAccount(provider, providerAccountId) instead of erroring", async () => {
    mocks.authAccountFindFirst
      .mockResolvedValueOnce(null) // initial lookup: no account yet
      .mockResolvedValueOnce({ id: "auth-acct-concurrent" }) // recovery lookup after the unique-constraint catch
    mocks.appUserFindFirst.mockResolvedValue(EXISTING_USER)
    const uniqueConstraintError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.22.0",
    })
    mocks.authAccountCreate.mockRejectedValue(uniqueConstraintError)

    const result = await linkSocialAccountToAppUser({
      provider: "spotify",
      providerAccountId: "spotify-acct-race",
      email: "shared@example.com",
      // Verified email → resolves to the existing account (the test's intent); the race is
      // then on the AuthAccount link, not on AppUser creation.
      emailVerified: true,
    })

    expect(result.id).toBe(EXISTING_USER.id)
    expect(mocks.authAccountFindFirst).toHaveBeenCalledTimes(2)
  })
})
