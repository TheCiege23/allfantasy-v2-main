import { beforeEach, describe, expect, it, vi } from "vitest"

const challengeFindUniqueMock = vi.hoisted(() => vi.fn())
const entryFindManyMock = vi.hoisted(() => vi.fn())
const entryCreateMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    playoffBracketChallenge: { findUnique: challengeFindUniqueMock },
    playoffBracketEntry: {
      findMany: entryFindManyMock,
      create: entryCreateMock,
      findUnique: vi.fn(),
    },
    playoffBracketSeries: { count: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), createMany: vi.fn() },
    playoffBracketPick: { count: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
  },
}))

/**
 * `getPlayoffBracketView` already returns `maxParticipants` and `maxEntriesPerParticipant` to
 * the client, so a pool has been DISPLAYING its limits while `createPlayoffBracketEntry`
 * ignored the config and allowed a hard-coded 5 per user. These pin the server to the same
 * numbers the UI renders.
 */
const USER = { id: "user-1", email: "u1@example.com" } as never

function challenge(config: Record<string, unknown> | null, ownerUserId = "owner-1") {
  return { id: "challenge-1", ownerUserId, config }
}

/** `findMany` is called for the caller's own entries first, then for distinct participants. */
function entriesThen(own: unknown[], distinct: Array<{ userId: string }>) {
  entryFindManyMock.mockReset()
  entryFindManyMock.mockResolvedValueOnce(own).mockResolvedValueOnce(distinct)
}

describe("createPlayoffBracketEntry — caps", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    entryCreateMock.mockResolvedValue({ id: "entry-new" })
  })

  it("honours maxEntriesPerParticipant instead of the hard-coded 5", async () => {
    const { createPlayoffBracketEntry } = await import("@/lib/playoffs/playoffService")
    challengeFindUniqueMock.mockResolvedValue(challenge({ maxEntriesPerParticipant: 2 }))
    // Two existing entries, limit 2 — the old code allowed this because 2 < 5.
    entriesThen([{ id: "e1" }, { id: "e2" }], [{ userId: "user-1" }])

    await expect(
      createPlayoffBracketEntry({ challengeId: "challenge-1", user: USER }),
    ).rejects.toThrow(/max 2 per person/i)
    expect(entryCreateMock).not.toHaveBeenCalled()
  })

  it("a one-bracket pool says so in plain words", async () => {
    const { createPlayoffBracketEntry } = await import("@/lib/playoffs/playoffService")
    challengeFindUniqueMock.mockResolvedValue(challenge({ maxEntriesPerParticipant: 1 }))
    entriesThen([{ id: "e1" }], [{ userId: "user-1" }])

    await expect(
      createPlayoffBracketEntry({ challengeId: "challenge-1", user: USER }),
    ).rejects.toThrow("This pool allows one bracket per person.")
  })

  it("an unconfigured pool falls back to the documented default of one", async () => {
    // `sanitizePlayoffChallengeConfig` defaults maxEntriesPerParticipant to 1, and the view has
    // been reporting that number to the UI all along.
    const { createPlayoffBracketEntry } = await import("@/lib/playoffs/playoffService")
    challengeFindUniqueMock.mockResolvedValue(challenge(null))
    entriesThen([{ id: "e1" }], [{ userId: "user-1" }])

    await expect(
      createPlayoffBracketEntry({ challengeId: "challenge-1", user: USER }),
    ).rejects.toThrow(/one bracket per person/i)
  })

  it("still creates when under the per-person cap", async () => {
    const { createPlayoffBracketEntry } = await import("@/lib/playoffs/playoffService")
    challengeFindUniqueMock.mockResolvedValue(challenge({ maxEntriesPerParticipant: 3 }))
    entriesThen([{ id: "e1" }], [{ userId: "user-1" }])

    const result = await createPlayoffBracketEntry({ challengeId: "challenge-1", user: USER })
    expect(result.entryId).toBe("entry-new")
    expect(entryCreateMock).toHaveBeenCalledTimes(1)
  })

  it("refuses a NEW participant when the pool is full", async () => {
    const { createPlayoffBracketEntry } = await import("@/lib/playoffs/playoffService")
    challengeFindUniqueMock.mockResolvedValue(challenge({ maxParticipants: 2 }))
    // Caller has no entry yet; two other people already hold the seats.
    entriesThen([], [{ userId: "other-a" }, { userId: "other-b" }])

    await expect(
      createPlayoffBracketEntry({ challengeId: "challenge-1", user: USER }),
    ).rejects.toThrow(/pool is full \(2 participants\)/i)
    expect(entryCreateMock).not.toHaveBeenCalled()
  })

  it("the participant cap counts PEOPLE, so an existing member is not blocked by it", async () => {
    /*
     * The trap this pins: counting ENTRIES instead of distinct people would refuse a second
     * bracket in a pool that has room for it. The caller is already inside the pool, so only
     * the per-person cap applies.
     */
    const { createPlayoffBracketEntry } = await import("@/lib/playoffs/playoffService")
    challengeFindUniqueMock.mockResolvedValue(
      challenge({ maxParticipants: 2, maxEntriesPerParticipant: 3 }),
    )
    entriesThen([{ id: "e1" }], [{ userId: "user-1" }, { userId: "other-a" }])

    const result = await createPlayoffBracketEntry({ challengeId: "challenge-1", user: USER })
    expect(result.entryId).toBe("entry-new")
    // The distinct-participant query must not even run for an existing member.
    expect(entryFindManyMock).toHaveBeenCalledTimes(1)
  })

  it("the participant query counts distinct users, not rows", async () => {
    const { createPlayoffBracketEntry } = await import("@/lib/playoffs/playoffService")
    challengeFindUniqueMock.mockResolvedValue(challenge({ maxParticipants: 50 }))
    entriesThen([], [{ userId: "other-a" }])

    await createPlayoffBracketEntry({ challengeId: "challenge-1", user: USER })

    expect(entryFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ distinct: ["userId"] }),
    )
  })
})
