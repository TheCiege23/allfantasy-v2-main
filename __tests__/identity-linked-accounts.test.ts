/**
 * Linked-account resolution — the duplicate-league gate's evidence layer.
 *
 * The invariants that matter here are about what the resolver must NOT do: it must not
 * claim two accounts are one human without a shared platform identity, and it must not
 * miss a duplicate that arrived through the other id space on `Roster.platformUserId`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  identityFindMany: vi.fn(),
  rosterFindFirst: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    platformIdentity: { findMany: mocks.identityFindMany },
    roster: { findFirst: mocks.rosterFindFirst },
  },
}))

import {
  findExistingLeagueClaim,
  resolveLinkedAccounts,
  resolveRosterOwnerIds,
} from "@/lib/identity/linkedAccounts"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rosterFindFirst.mockResolvedValue(null)
})

describe("resolveLinkedAccounts", () => {
  it("returns ONLY the user, and no evidence, when they have no platform identity", async () => {
    // The 98%-of-users case. Absence of evidence must never read as proof of uniqueness.
    mocks.identityFindMany.mockResolvedValueOnce([])
    const result = await resolveLinkedAccounts("user-1")
    expect(result).toEqual({ userIds: ["user-1"], platformUserIds: [], hasIdentityEvidence: false })
    // No second hop — nothing to match on.
    expect(mocks.identityFindMany).toHaveBeenCalledTimes(1)
  })

  it("finds sibling accounts sharing a platform identity", async () => {
    mocks.identityFindMany
      .mockResolvedValueOnce([{ platform: "sleeper", platformUserId: "sleeper-99" }])
      .mockResolvedValueOnce([
        { userId: "user-1", platformUserId: "sleeper-99" },
        { userId: "user-2", platformUserId: "sleeper-99" }, // the duplicate account
      ])
    const result = await resolveLinkedAccounts("user-1")
    expect(result.userIds.sort()).toEqual(["user-1", "user-2"])
    expect(result.platformUserIds).toEqual(["sleeper-99"])
    expect(result.hasIdentityEvidence).toBe(true)
  })

  it("always includes the caller even when the sibling query omits them", async () => {
    mocks.identityFindMany
      .mockResolvedValueOnce([{ platform: "sleeper", platformUserId: "s-1" }])
      .mockResolvedValueOnce([{ userId: "user-2", platformUserId: "s-1" }])
    const result = await resolveLinkedAccounts("user-1")
    expect(result.userIds).toContain("user-1")
  })

  it("matches on the (platform, id) PAIR, not the id alone", async () => {
    // A Sleeper id and an ESPN id could collide as bare strings; the pair cannot.
    mocks.identityFindMany
      .mockResolvedValueOnce([{ platform: "sleeper", platformUserId: "12345" }])
      .mockResolvedValueOnce([])
    await resolveLinkedAccounts("user-1")
    expect(mocks.identityFindMany.mock.calls[1][0].where).toEqual({
      OR: [{ platform: "sleeper", platformUserId: "12345" }],
    })
  })
})

describe("resolveRosterOwnerIds — both id spaces", () => {
  it("returns AF user ids AND provider ids", async () => {
    // Roster.platformUserId holds the AF id for on-site joins and the PROVIDER id for
    // imported leagues. Checking one space only would pass duplicates from the other.
    mocks.identityFindMany
      .mockResolvedValueOnce([{ platform: "sleeper", platformUserId: "sleeper-99" }])
      .mockResolvedValueOnce([
        { userId: "user-1", platformUserId: "sleeper-99" },
        { userId: "user-2", platformUserId: "sleeper-99" },
      ])
    const ids = await resolveRosterOwnerIds("user-1")
    expect(ids.sort()).toEqual(["sleeper-99", "user-1", "user-2"])
  })
})

describe("findExistingLeagueClaim", () => {
  it("flags a claim held by a DIFFERENT account as the duplicate case", async () => {
    mocks.identityFindMany
      .mockResolvedValueOnce([{ platform: "sleeper", platformUserId: "s-1" }])
      .mockResolvedValueOnce([
        { userId: "user-1", platformUserId: "s-1" },
        { userId: "user-2", platformUserId: "s-1" },
      ])
    mocks.rosterFindFirst.mockResolvedValue({ id: "roster-1", platformUserId: "user-2" })

    const claim = await findExistingLeagueClaim({ userId: "user-1", leagueId: "lg-1" })
    expect(claim).toMatchObject({ rosterId: "roster-1", viaOtherAccount: true })
  })

  it("does NOT flag the caller's own existing roster as a duplicate", async () => {
    // Ordinary rejoin. Treating this as a duplicate would lock users out of their own team.
    mocks.identityFindMany
      .mockResolvedValueOnce([{ platform: "sleeper", platformUserId: "s-1" }])
      .mockResolvedValueOnce([{ userId: "user-1", platformUserId: "s-1" }])
    mocks.rosterFindFirst.mockResolvedValue({ id: "roster-1", platformUserId: "user-1" })

    const claim = await findExistingLeagueClaim({ userId: "user-1", leagueId: "lg-1" })
    expect(claim?.viaOtherAccount).toBe(false)
  })

  it("returns null when nobody linked holds a roster", async () => {
    mocks.identityFindMany
      .mockResolvedValueOnce([{ platform: "sleeper", platformUserId: "s-1" }])
      .mockResolvedValueOnce([{ userId: "user-1", platformUserId: "s-1" }])
    mocks.rosterFindFirst.mockResolvedValue(null)
    expect(await findExistingLeagueClaim({ userId: "user-1", leagueId: "lg-1" })).toBeNull()
  })

  it("scopes the roster lookup to the league being joined", async () => {
    mocks.identityFindMany
      .mockResolvedValueOnce([{ platform: "sleeper", platformUserId: "s-1" }])
      .mockResolvedValueOnce([{ userId: "user-1", platformUserId: "s-1" }])
    await findExistingLeagueClaim({ userId: "user-1", leagueId: "lg-42" })
    expect(mocks.rosterFindFirst.mock.calls[0][0].where.leagueId).toBe("lg-42")
  })

  it("lets a user with NO platform identity through (documented coverage limit)", async () => {
    mocks.identityFindMany.mockResolvedValueOnce([])
    mocks.rosterFindFirst.mockResolvedValue(null)
    const claim = await findExistingLeagueClaim({ userId: "user-1", leagueId: "lg-1" })
    expect(claim).toBeNull()
  })
})
