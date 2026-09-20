import { beforeEach, describe, expect, it, vi } from "vitest"

const challengeFindUniqueMock = vi.hoisted(() => vi.fn())
const pickFindManyMock = vi.hoisted(() => vi.fn())
const seriesFindManyMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    playoffBracketChallenge: { findUnique: challengeFindUniqueMock },
    playoffBracketEntry: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
    playoffBracketSeries: {
      count: vi.fn(),
      findUnique: vi.fn(),
      findMany: seriesFindManyMock,
      createMany: vi.fn(),
    },
    playoffBracketPick: {
      count: vi.fn(),
      findMany: pickFindManyMock,
      deleteMany: vi.fn(),
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

/**
 * `/brackets/leagues/[id]` renders SERVER-SIDE with `user: session?.user ?? null`. So whatever
 * this view returns for a null user is what an anonymous visitor holding a pool id can read.
 *
 * Verified, not assumed: `requiresSessionAuth` (lib/auth/session-auth-paths.ts) gates only
 * `/af-rankings`, `/dashboard/rankings`, `/league/` and `/app/league/` — `/brackets/` is not in
 * it. And `GET /api/brackets/playoffs/[challengeId]` DOES gate via `requireWorldCupApiUser`,
 * which is exactly why the page is the leaky path and the API is not.
 *
 * ⚠ That gating file's own note says the `/app/league/*` rule "holds only as long as EVERY API
 * those pages call checks its caller". This page never calls one — it renders on the server —
 * so an API-level gate could not have protected it. The check has to live in the view itself.
 *
 * A signed-in NON-MEMBER already resolves to `activeEntry: null`, so null is an exercised,
 * supported state — anonymous should land in the same place rather than on someone's entry.
 */
const OWNER = {
  id: "owner-1",
  displayName: null,
  username: null,
  email: "commissioner@example.com",
}

const ALICE_ENTRY = {
  id: "entry-alice",
  userId: "user-alice",
  name: "Alice Bracket",
  createdAt: new Date("2026-04-01T00:00:00Z"),
  user: { id: "user-alice", displayName: null, username: null, email: "alice@example.com" },
}

const BOB_ENTRY = {
  id: "entry-bob",
  userId: "user-bob",
  name: "Bob Bracket",
  createdAt: new Date("2026-04-02T00:00:00Z"),
  user: { id: "user-bob", displayName: "Bobby", username: "bobby", email: "bob@example.com" },
}

function challengeRow() {
  return {
    id: "challenge-1",
    name: "Private Pool",
    ownerUserId: OWNER.id,
    owner: OWNER,
    sport: "nba",
    isTestMode: false,
    config: null,
    entries: [ALICE_ENTRY, BOB_ENTRY],
    series: [],
  }
}

describe("playoff bracket view — anonymous privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    challengeFindUniqueMock.mockResolvedValue(challengeRow())
    seriesFindManyMock.mockResolvedValue([])
    // Any pick read returns Alice's picks, so a leak is unmistakable if one happens.
    pickFindManyMock.mockResolvedValue([
      { id: "p1", entryId: "entry-alice", seriesId: "s1", pickTeamName: "Boston Celtics" },
    ])
  })

  it("gives an anonymous viewer NO active entry and NO picks", async () => {
    const { getPlayoffBracketView } = await import("@/lib/playoffs/playoffService")
    const view = await getPlayoffBracketView({ challengeId: "challenge-1", user: null })

    expect(view).not.toBeNull()
    expect(view!.viewerUserId).toBeNull()
    // Before the fix this was `challenge.entries[0]` — Alice's entry — and her picks loaded.
    expect(view!.activeEntry, "anonymous must not be handed someone else's entry").toBeNull()
    expect(view!.picks ?? []).toEqual([])
  })

  it("ignores a guessed ?entryId= from an anonymous viewer", async () => {
    const { getPlayoffBracketView } = await import("@/lib/playoffs/playoffService")
    const view = await getPlayoffBracketView({
      challengeId: "challenge-1",
      user: null,
      requestedEntryId: "entry-bob",
    })

    // Before the fix `requestedEntry` returned true for ANY entryId when there was no user,
    // so a pool id plus an entry id was enough to read that entrant's bracket.
    expect(view!.activeEntry).toBeNull()
    expect(view!.picks ?? []).toEqual([])
  })

  it("never uses an email address as a display name", async () => {
    const { getPlayoffBracketView } = await import("@/lib/playoffs/playoffService")
    const view = await getPlayoffBracketView({ challengeId: "challenge-1", user: null })

    const names = view!.participants.map((p) => p.displayName)
    for (const name of names) {
      expect(name, `"${name}" looks like an email address`).not.toMatch(/@/)
    }
    // Alice and the owner have neither displayName nor username, so they must fall through to
    // the neutral labels that already existed below the email rung.
    expect(names).toContain("Participant")
    expect(names).toContain("Commissioner")
    // Bobby has a real display name and must be unaffected.
    expect(names).toContain("Bobby")
  })

  it("a signed-in member still gets their OWN entry and picks", async () => {
    // The control: the fix must not lock out the people the view exists for.
    const { getPlayoffBracketView } = await import("@/lib/playoffs/playoffService")
    const view = await getPlayoffBracketView({
      challengeId: "challenge-1",
      user: { id: "user-alice", email: "alice@example.com" } as never,
    })

    expect(view!.activeEntry?.id).toBe("entry-alice")
    expect(view!.picks.length).toBeGreaterThan(0)
  })

  it("a signed-in member cannot request ANOTHER member's entry", async () => {
    const { getPlayoffBracketView } = await import("@/lib/playoffs/playoffService")
    const view = await getPlayoffBracketView({
      challengeId: "challenge-1",
      user: { id: "user-alice", email: "alice@example.com" } as never,
      requestedEntryId: "entry-bob",
    })

    expect(view!.activeEntry?.id).not.toBe("entry-bob")
  })
})
