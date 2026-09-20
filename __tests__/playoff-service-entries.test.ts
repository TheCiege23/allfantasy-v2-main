import { beforeEach, describe, expect, it, vi } from "vitest"

const challengeFindUniqueMock = vi.hoisted(() => vi.fn())
const entryFindManyMock = vi.hoisted(() => vi.fn())
const entryCreateMock = vi.hoisted(() => vi.fn())
const entryFindUniqueMock = vi.hoisted(() => vi.fn())
const seriesCountMock = vi.hoisted(() => vi.fn())
const pickCountMock = vi.hoisted(() => vi.fn())
const seriesFindUniqueMock = vi.hoisted(() => vi.fn())
const seriesFindManyMock = vi.hoisted(() => vi.fn())
const pickFindManyMock = vi.hoisted(() => vi.fn())
const pickDeleteManyMock = vi.hoisted(() => vi.fn())
const pickUpsertMock = vi.hoisted(() => vi.fn())
const transactionMock = vi.hoisted(() => vi.fn())
const challengeCreateMock = vi.hoisted(() => vi.fn())
const seriesCreateManyMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    playoffBracketChallenge: {
      findUnique: challengeFindUniqueMock,
      create: challengeCreateMock,
    },
    playoffBracketEntry: {
      findMany: entryFindManyMock,
      create: entryCreateMock,
      findUnique: entryFindUniqueMock,
    },
    playoffBracketSeries: {
      count: seriesCountMock,
      findUnique: seriesFindUniqueMock,
      findMany: seriesFindManyMock,
      createMany: seriesCreateManyMock,
    },
    playoffBracketPick: {
      count: pickCountMock,
      findMany: pickFindManyMock,
      deleteMany: pickDeleteManyMock,
      upsert: pickUpsertMock,
    },
    $transaction: transactionMock,
  },
}))

describe("playoff entry service", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    challengeFindUniqueMock.mockResolvedValue({ id: "challenge-1" })
    transactionMock.mockImplementation((callback) =>
      callback({
        playoffBracketPick: {
          deleteMany: pickDeleteManyMock,
          upsert: pickUpsertMock,
        },
        playoffBracketChallenge: {
          create: challengeCreateMock,
        },
        playoffBracketSeries: {
          createMany: seriesCreateManyMock,
        },
      })
    )
  })

  it("creates multiple NBA playoff challenge rows separately", async () => {
    challengeCreateMock
      .mockResolvedValueOnce({ id: "challenge-1", name: "Friends NBA Pool" })
      .mockResolvedValueOnce({ id: "challenge-2", name: "Work NBA Pool" })
    seriesCreateManyMock.mockResolvedValue({ count: 15 })

    const { createPlayoffBracketChallenge } = await import("@/lib/playoffs/playoffService")
    const first = await createPlayoffBracketChallenge({
      user: { id: "user-1" },
      name: "Friends NBA Pool",
      sport: "nba",
      seasonYear: 2026,
    })
    const second = await createPlayoffBracketChallenge({
      user: { id: "user-1" },
      name: "Work NBA Pool",
      sport: "nba",
      seasonYear: 2026,
    })

    expect(first.challengeId).toBe("challenge-1")
    expect(second.challengeId).toBe("challenge-2")
    expect(challengeCreateMock).toHaveBeenCalledTimes(2)
    expect(challengeCreateMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({
        sport: "nba",
        config: expect.objectContaining({ includePlayIn: false }),
      }),
    }))
  })

  it("reloads saved Boston pick after provider result says Philadelphia", async () => {
    const now = new Date("2026-05-20T00:00:00.000Z")
    challengeFindUniqueMock.mockResolvedValue({
      id: "challenge-1",
      name: "NBA Playoff Pool",
      ownerUserId: "owner-1",
      sport: "nba",
      seasonYear: 2026,
      status: "open",
      isTestMode: true,
      config: { lockRule: "none" },
      createdAt: now,
      updatedAt: now,
      owner: { displayName: "Owner", username: "owner", email: "owner@example.com" },
      entries: [
        {
          id: "entry-1",
          name: "Bracket 1",
          userId: "user-1",
          createdAt: now,
          user: { displayName: "Tester", username: "tester", email: "tester@example.com" },
        },
      ],
      series: [
        {
          id: "s1",
          round: "round_1",
          roundIndex: 1,
          seriesNumber: 1,
          conference: "east",
          homeSeed: 1,
          awaySeed: 8,
          homeTeamName: "Boston Celtics",
          awayTeamName: "Philadelphia 76ers",
          winnerTeamName: "Philadelphia 76ers",
          bestOf: 7,
          status: "final",
          startsAt: null,
          homeTeamWins: 2,
          awayTeamWins: 4,
          seriesSummary: "Philadelphia 76ers win series 4-2",
          nextGameAt: null,
          venue: null,
          broadcastNetwork: null,
          liveHomeScore: null,
          liveAwayScore: null,
          liveStatus: null,
          providerGamesJson: null,
          lastSyncedAt: now,
          nextSeriesNumber: 9,
          nextSeriesSlot: "home",
          sourceSeriesHome: null,
          sourceSeriesAway: null,
        },
        {
          id: "s9",
          round: "conference_semifinals",
          roundIndex: 2,
          seriesNumber: 9,
          conference: "east",
          homeSeed: 0,
          awaySeed: 0,
          homeTeamName: "Winner S1",
          awayTeamName: "Winner S2",
          winnerTeamName: null,
          bestOf: 7,
          status: "scheduled",
          startsAt: null,
          homeTeamWins: 0,
          awayTeamWins: 0,
          seriesSummary: null,
          nextGameAt: null,
          venue: null,
          broadcastNetwork: null,
          liveHomeScore: null,
          liveAwayScore: null,
          liveStatus: null,
          providerGamesJson: null,
          lastSyncedAt: null,
          nextSeriesNumber: 13,
          nextSeriesSlot: "home",
          sourceSeriesHome: 1,
          sourceSeriesAway: 2,
        },
      ],
    })
    pickFindManyMock
      .mockResolvedValueOnce([{ id: "p1", entryId: "entry-1", seriesId: "s1", pickTeamName: "Boston Celtics", createdAt: now, updatedAt: now }])
      .mockResolvedValueOnce([{ entryId: "entry-1", seriesId: "s1", pickTeamName: "Boston Celtics" }])

    const { getPlayoffBracketView } = await import("@/lib/playoffs/playoffService")
    const view = await getPlayoffBracketView({
      challengeId: "challenge-1",
      user: { id: "user-1", email: "tester@example.com", name: "Tester" },
      requestedEntryId: "entry-1",
    })

    expect(view?.picks).toEqual([
      expect.objectContaining({ seriesId: "s1", pickTeamName: "Boston Celtics" }),
    ])
    expect(view?.series.find((item) => item.id === "s1")?.winnerTeamName).toBe("Philadelphia 76ers")
  })

  it("creates an entry when the user is under the pool's per-person cap", async () => {
    // The cap now comes from the pool's own config rather than a hard-coded 5, so a test that
    // wants a SECOND bracket has to say the pool allows more than one. What this case is
    // actually for — creation and the generated name — is unchanged.
    challengeFindUniqueMock.mockResolvedValue({
      id: "challenge-1",
      ownerUserId: "owner-1",
      config: { maxEntriesPerParticipant: 3 },
    })
    entryFindManyMock.mockResolvedValue([{ id: "entry-1" }])
    entryCreateMock.mockResolvedValue({ id: "entry-2" })

    const { createPlayoffBracketEntry } = await import("@/lib/playoffs/playoffService")

    const result = await createPlayoffBracketEntry({
      challengeId: "challenge-1",
      user: { id: "user-1", name: "Tester" },
    })

    expect(result.entryId).toBe("entry-2")
    expect(result.redirectUrl).toBe("/brackets/leagues/challenge-1/entries/entry-2")
    expect(entryCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Tester's Bracket 2",
        }),
      })
    )
  })

  it("blocks the entry that would exceed the pool's configured cap", async () => {
    /*
     * ⚠ This used to assert the hard-coded "max 5 per user". Re-pointing it at the CONFIGURED
     * cap is the whole point of the change — a pool set to 3 must stop at 3, not at 5. The
     * number lives in the mock so the assertion cannot pass against a magic constant again.
     */
    challengeFindUniqueMock.mockResolvedValue({
      id: "challenge-1",
      ownerUserId: "owner-1",
      config: { maxEntriesPerParticipant: 3 },
    })
    entryFindManyMock.mockResolvedValue(Array.from({ length: 3 }).map((_, i) => ({ id: `entry-${i + 1}` })))

    const { createPlayoffBracketEntry } = await import("@/lib/playoffs/playoffService")

    await expect(
      createPlayoffBracketEntry({
        challengeId: "challenge-1",
        user: { id: "user-1", name: "Tester" },
      })
    ).rejects.toThrow("Entry limit reached (max 3 per person).")
    expect(entryCreateMock).not.toHaveBeenCalled()
  })

  it("submits a complete entry back to the pool dashboard", async () => {
    entryFindUniqueMock.mockResolvedValue({ id: "entry-2", userId: "user-1", challengeId: "challenge-1" })
    seriesFindManyMock.mockResolvedValue([{ id: "s1", homeTeamName: "Knicks", awayTeamName: "Hawks", status: "scheduled", startsAt: null }])
    pickFindManyMock.mockResolvedValue([{ id: "p1", entryId: "entry-2", seriesId: "s1", pickTeamName: "Knicks", createdAt: "", updatedAt: "" }])

    const { submitPlayoffBracketEntry } = await import("@/lib/playoffs/playoffService")

    const result = await submitPlayoffBracketEntry({
      challengeId: "challenge-1",
      entryId: "entry-2",
      userId: "user-1",
    })

    expect(result.redirectUrl).toBe("/brackets/leagues/challenge-1")
  })

  it("submits available picks only for no-lock admin verification pools", async () => {
    entryFindUniqueMock.mockResolvedValue({
      id: "entry-2",
      userId: "admin-user",
      challengeId: "challenge-1",
      challenge: { config: { lockRule: "none" }, ownerUserId: "owner-user", isTestMode: false },
    })
    seriesFindManyMock.mockResolvedValue([
      { id: "s1", homeTeamName: "Knicks", awayTeamName: "Hawks", status: "in_progress", startsAt: new Date("2026-05-01T00:00:00.000Z"), roundIndex: 1, seriesNumber: 1 },
      { id: "s9", homeTeamName: "Winner S1", awayTeamName: "Winner S2", status: "scheduled", startsAt: null, roundIndex: 2, seriesNumber: 9 },
    ])
    pickFindManyMock.mockResolvedValue([{ id: "p1", entryId: "entry-2", seriesId: "s1", pickTeamName: "Knicks", createdAt: "", updatedAt: "" }])

    const { submitPlayoffBracketEntry } = await import("@/lib/playoffs/playoffService")
    const result = await submitPlayoffBracketEntry({
      challengeId: "challenge-1",
      entryId: "entry-2",
      userId: "admin-user",
      user: { id: "admin-user", email: "Cjabar.henson@gmail.com" },
    })

    expect(result.redirectUrl).toBe("/brackets/leagues/challenge-1")
  })

  it("blocks available-only submit when an available series is missing", async () => {
    entryFindUniqueMock.mockResolvedValue({
      id: "entry-2",
      userId: "admin-user",
      challengeId: "challenge-1",
      challenge: { config: { lockRule: "none" }, ownerUserId: "owner-user", isTestMode: false },
    })
    seriesFindManyMock.mockResolvedValue([
      { id: "s1", homeTeamName: "Knicks", awayTeamName: "Hawks", status: "in_progress", startsAt: new Date("2026-05-01T00:00:00.000Z"), roundIndex: 1, seriesNumber: 1 },
      { id: "s9", homeTeamName: "Winner S1", awayTeamName: "Winner S2", status: "scheduled", startsAt: null, roundIndex: 2, seriesNumber: 9 },
    ])
    pickFindManyMock.mockResolvedValue([])

    const { submitPlayoffBracketEntry } = await import("@/lib/playoffs/playoffService")
    await expect(submitPlayoffBracketEntry({
      challengeId: "challenge-1",
      entryId: "entry-2",
      userId: "admin-user",
      user: { id: "admin-user", email: "Cjabar.henson@gmail.com" },
    })).rejects.toThrow("Complete all currently available series before submitting this test bracket.")
  })

  it("does not allow normal users to partial-submit strict pools", async () => {
    entryFindUniqueMock.mockResolvedValue({
      id: "entry-2",
      userId: "user-1",
      challengeId: "challenge-1",
      challenge: { config: { lockRule: "series_start" }, ownerUserId: "owner-user", isTestMode: false },
    })
    seriesFindManyMock.mockResolvedValue([
      { id: "s1", homeTeamName: "Knicks", awayTeamName: "Hawks", status: "scheduled", startsAt: null, roundIndex: 1, seriesNumber: 1 },
      { id: "s9", homeTeamName: "Winner S1", awayTeamName: "Winner S2", status: "scheduled", startsAt: null, roundIndex: 2, seriesNumber: 9 },
    ])
    pickFindManyMock.mockResolvedValue([{ id: "p1", entryId: "entry-2", seriesId: "s1", pickTeamName: "Knicks", createdAt: "", updatedAt: "" }])

    const { submitPlayoffBracketEntry } = await import("@/lib/playoffs/playoffService")
    await expect(submitPlayoffBracketEntry({
      challengeId: "challenge-1",
      entryId: "entry-2",
      userId: "user-1",
      user: { id: "user-1", email: "user@example.com" },
    })).rejects.toThrow("Complete every series before submitting this bracket.")
  })

  it("provides sport-specific naming helpers", async () => {
    const { getPlayoffSportTitle } = await import("@/lib/playoffs/playoffService")
    expect(getPlayoffSportTitle("nba")).toBe("NBA Playoff Pool")
    expect(getPlayoffSportTitle("nhl")).toBe("NHL Playoff Pool")
    expect(getPlayoffSportTitle("fifa")).toBe("FIFA World Cup Pool")
  })

  it("returns provider series metadata from the playoff view", async () => {
    const now = new Date("2026-05-21T20:30:00.000Z")
    challengeFindUniqueMock.mockResolvedValue({
      id: "challenge-1",
      ownerUserId: "user-1",
      name: "NBA Pool",
      sport: "nba",
      seasonYear: 2026,
      status: "open",
      isTestMode: false,
      createdAt: now,
      updatedAt: now,
      owner: { id: "user-1", displayName: "Owner", username: null, email: null },
      entries: [
        {
          id: "entry-1",
          userId: "user-1",
          name: "Entry",
          createdAt: now,
          user: { id: "user-1", displayName: "Owner", username: null, email: null },
        },
      ],
      series: [
        {
          id: "s1",
          round: "round_1",
          roundIndex: 1,
          seriesNumber: 1,
          conference: "east",
          homeSeed: 1,
          awaySeed: 8,
          homeTeamName: "Knicks",
          awayTeamName: "Hawks",
          winnerTeamName: "Knicks",
          bestOf: 7,
          status: "final",
          startsAt: now,
          homeTeamWins: 4,
          awayTeamWins: 0,
          seriesSummary: "Knicks win series 4-0",
          nextGameAt: null,
          venue: "Madison Square Garden",
          broadcastNetwork: "TNT",
          liveHomeScore: null,
          liveAwayScore: null,
          liveStatus: null,
          providerGamesJson: [{ homeTeam: "Knicks", awayTeam: "Hawks" }],
          lastSyncedAt: now,
          nextSeriesNumber: 9,
          nextSeriesSlot: "home",
          sourceSeriesHome: null,
          sourceSeriesAway: null,
        },
      ],
    })
    pickFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const { getPlayoffBracketView } = await import("@/lib/playoffs/playoffService")
    const view = await getPlayoffBracketView({
      challengeId: "challenge-1",
      user: { id: "user-1" },
      requestedEntryId: "entry-1",
    })

    expect(view?.series[0]).toMatchObject({
      homeTeamWins: 4,
      awayTeamWins: 0,
      seriesSummary: "Knicks win series 4-0",
      venue: "Madison Square Garden",
      broadcastNetwork: "TNT",
      providerGamesJson: [{ homeTeam: "Knicks", awayTeam: "Hawks" }],
    })
    expect(view?.challenge.lockRule).toBe("series_start")
    expect(view?.activeEntry).toMatchObject({
      totalScore: 0,
      correctPicks: 0,
      resolvedPicks: 0,
    })
    expect(view?.lockDiagnostics).toMatchObject({
      lockRule: "series_start",
      allowTestLatePicks: false,
      viewerCanLatePick: false,
    })
  })

  it("loads saved picks for the requested playoff entry after reload", async () => {
    const now = new Date("2026-05-21T20:30:00.000Z")
    challengeFindUniqueMock.mockResolvedValue({
      id: "challenge-1",
      ownerUserId: "user-1",
      name: "NBA Pool",
      sport: "nba",
      seasonYear: 2026,
      status: "open",
      isTestMode: true,
      createdAt: now,
      updatedAt: now,
      owner: { id: "user-1", displayName: "Owner", username: null, email: null },
      entries: [
        { id: "entry-1", userId: "user-1", name: "Entry 1", createdAt: now, user: { id: "user-1", displayName: "Owner", username: null, email: null } },
        { id: "entry-2", userId: "user-1", name: "Entry 2", createdAt: now, user: { id: "user-1", displayName: "Owner", username: null, email: null } },
      ],
      series: [
        {
          id: "s1",
          round: "round_1",
          roundIndex: 1,
          seriesNumber: 1,
          conference: "east",
          homeSeed: 1,
          awaySeed: 8,
          homeTeamName: "Detroit Pistons",
          awayTeamName: "Philadelphia 76ers",
          winnerTeamName: null,
          bestOf: 7,
          status: "scheduled",
          startsAt: null,
          homeTeamWins: 0,
          awayTeamWins: 0,
          seriesSummary: null,
          nextGameAt: null,
          venue: null,
          broadcastNetwork: null,
          liveHomeScore: null,
          liveAwayScore: null,
          liveStatus: null,
          providerGamesJson: null,
          lastSyncedAt: null,
          nextSeriesNumber: 9,
          nextSeriesSlot: "home",
          sourceSeriesHome: null,
          sourceSeriesAway: null,
        },
      ],
    })
    pickFindManyMock
      .mockResolvedValueOnce([{ id: "p2", entryId: "entry-2", seriesId: "s1", pickTeamName: "Detroit Pistons", createdAt: now, updatedAt: now }])
      .mockResolvedValueOnce([
        { entryId: "entry-1", seriesId: "s1", pickTeamName: "Philadelphia 76ers" },
        { entryId: "entry-2", seriesId: "s1", pickTeamName: "Detroit Pistons" },
      ])

    const { getPlayoffBracketView } = await import("@/lib/playoffs/playoffService")
    const view = await getPlayoffBracketView({
      challengeId: "challenge-1",
      user: { id: "user-1" },
      requestedEntryId: "entry-2",
    })

    expect(view?.activeEntry?.id).toBe("entry-2")
    expect(view?.picks).toEqual([
      expect.objectContaining({ entryId: "entry-2", seriesId: "s1", pickTeamName: "Detroit Pistons" }),
    ])
  })

  it("clears downstream picks when an earlier pick changes", async () => {
    entryFindUniqueMock.mockResolvedValue({ id: "entry-1", userId: "user-1", challengeId: "challenge-1" })
    seriesFindUniqueMock.mockResolvedValue({
      id: "s1",
      challengeId: "challenge-1",
      status: "scheduled",
      startsAt: null,
      homeTeamName: "Celtics",
      awayTeamName: "Heat",
    })
    seriesFindManyMock.mockResolvedValue([
      {
        id: "s1",
        challengeId: "challenge-1",
        roundIndex: 1,
        seriesNumber: 1,
        homeTeamName: "Celtics",
        awayTeamName: "Heat",
        sourceSeriesHome: null,
        sourceSeriesAway: null,
      },
      {
        id: "s9",
        challengeId: "challenge-1",
        roundIndex: 2,
        seriesNumber: 9,
        homeTeamName: "Winner S1",
        awayTeamName: "Winner S2",
        sourceSeriesHome: 1,
        sourceSeriesAway: 2,
      },
    ])
    pickFindManyMock.mockResolvedValue([{ id: "p9", entryId: "entry-1", seriesId: "s9", pickTeamName: "Celtics" }])
    pickUpsertMock.mockResolvedValue({ id: "p1", seriesId: "s1", pickTeamName: "Heat" })

    const { savePlayoffBracketPick } = await import("@/lib/playoffs/playoffService")
    await savePlayoffBracketPick({
      challengeId: "challenge-1",
      entryId: "entry-1",
      userId: "user-1",
      seriesId: "s1",
      pickTeamName: "Heat",
    })

    expect(pickDeleteManyMock).toHaveBeenCalledWith({
      where: {
        entryId: "entry-1",
        seriesId: { in: ["s9"] },
      },
    })
  })

  it("rejects locked series picks server-side", async () => {
    entryFindUniqueMock.mockResolvedValue({ id: "entry-1", userId: "user-1", challengeId: "challenge-1" })
    seriesFindUniqueMock.mockResolvedValue({
      id: "s1",
      challengeId: "challenge-1",
      status: "in_progress",
      startsAt: null,
      homeTeamName: "Celtics",
      awayTeamName: "Heat",
      challenge: { config: { lockRule: "series_start" } },
    })

    const { savePlayoffBracketPick } = await import("@/lib/playoffs/playoffService")
    await expect(
      savePlayoffBracketPick({
        challengeId: "challenge-1",
        entryId: "entry-1",
        userId: "user-1",
        seriesId: "s1",
        pickTeamName: "Celtics",
      })
    ).rejects.toThrow("Series already started/locked")

    expect(pickUpsertMock).not.toHaveBeenCalled()
  })

  it("allows started series picks when lock rule is none", async () => {
    entryFindUniqueMock.mockResolvedValue({ id: "entry-1", userId: "user-1", challengeId: "challenge-1" })
    seriesFindUniqueMock.mockResolvedValue({
      id: "s1",
      challengeId: "challenge-1",
      status: "final",
      startsAt: new Date("2026-05-01T00:00:00.000Z"),
      homeTeamName: "Celtics",
      awayTeamName: "Heat",
      challenge: { config: { lockRule: "none" }, ownerUserId: "user-1", isTestMode: false },
    })
    seriesFindManyMock.mockResolvedValue([
      {
        id: "s1",
        challengeId: "challenge-1",
        roundIndex: 1,
        seriesNumber: 1,
        homeTeamName: "Celtics",
        awayTeamName: "Heat",
        sourceSeriesHome: null,
        sourceSeriesAway: null,
      },
    ])
    pickFindManyMock.mockResolvedValue([])
    pickUpsertMock.mockResolvedValue({ id: "p1", seriesId: "s1", pickTeamName: "Celtics" })

    const { savePlayoffBracketPick } = await import("@/lib/playoffs/playoffService")
    await savePlayoffBracketPick({
      challengeId: "challenge-1",
      entryId: "entry-1",
      userId: "user-1",
      seriesId: "s1",
      pickTeamName: "Celtics",
    })

    expect(pickUpsertMock).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ seriesId: "s1", pickTeamName: "Celtics" }),
    }))
  })

  it("allows all-access admin late picks for no-lock pools", async () => {
    entryFindUniqueMock.mockResolvedValue({ id: "entry-1", userId: "admin-user", challengeId: "challenge-1" })
    seriesFindUniqueMock.mockResolvedValue({
      id: "s1",
      challengeId: "challenge-1",
      status: "in_progress",
      startsAt: new Date("2026-05-01T00:00:00.000Z"),
      homeTeamName: "Celtics",
      awayTeamName: "Heat",
      challenge: { config: { lockRule: "none" }, ownerUserId: "owner-user", isTestMode: false },
    })
    seriesFindManyMock.mockResolvedValue([
      {
        id: "s1",
        challengeId: "challenge-1",
        roundIndex: 1,
        seriesNumber: 1,
        homeTeamName: "Celtics",
        awayTeamName: "Heat",
        sourceSeriesHome: null,
        sourceSeriesAway: null,
      },
    ])
    pickFindManyMock.mockResolvedValue([])
    pickUpsertMock.mockResolvedValue({ id: "p1", seriesId: "s1", pickTeamName: "Heat" })

    const { savePlayoffBracketPick } = await import("@/lib/playoffs/playoffService")
    await savePlayoffBracketPick({
      challengeId: "challenge-1",
      entryId: "entry-1",
      userId: "admin-user",
      user: { id: "admin-user", email: "Cjabar.henson@gmail.com", username: "TheCiege26" },
      seriesId: "s1",
      pickTeamName: "Heat",
    })

    expect(pickUpsertMock).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ seriesId: "s1", pickTeamName: "Heat" }),
    }))
  })

  it("does not let all-access admin bypass strict late locks", async () => {
    entryFindUniqueMock.mockResolvedValue({ id: "entry-1", userId: "admin-user", challengeId: "challenge-1" })
    seriesFindUniqueMock.mockResolvedValue({
      id: "s1",
      challengeId: "challenge-1",
      status: "in_progress",
      startsAt: new Date("2026-05-01T00:00:00.000Z"),
      homeTeamName: "Celtics",
      awayTeamName: "Heat",
      challenge: { config: { lockRule: "series_start" }, ownerUserId: "owner-user", isTestMode: false },
    })

    const { savePlayoffBracketPick } = await import("@/lib/playoffs/playoffService")
    await expect(savePlayoffBracketPick({
      challengeId: "challenge-1",
      entryId: "entry-1",
      userId: "admin-user",
      user: { id: "admin-user", email: "Cjabar.henson@gmail.com", username: "TheCiege26" },
      seriesId: "s1",
      pickTeamName: "Heat",
    })).rejects.toThrow("Series already started/locked")

    expect(pickUpsertMock).not.toHaveBeenCalled()
  })

  it("still rejects invalid team names when lock rule is none", async () => {
    entryFindUniqueMock.mockResolvedValue({ id: "entry-1", userId: "user-1", challengeId: "challenge-1" })
    seriesFindUniqueMock.mockResolvedValue({
      id: "s1",
      challengeId: "challenge-1",
      status: "final",
      startsAt: new Date("2026-05-01T00:00:00.000Z"),
      homeTeamName: "Celtics",
      awayTeamName: "Heat",
      challenge: { config: { lockRule: "none" }, ownerUserId: "user-1", isTestMode: false },
    })
    seriesFindManyMock.mockResolvedValue([
      {
        id: "s1",
        challengeId: "challenge-1",
        roundIndex: 1,
        seriesNumber: 1,
        homeTeamName: "Celtics",
        awayTeamName: "Heat",
        sourceSeriesHome: null,
        sourceSeriesAway: null,
      },
    ])
    pickFindManyMock.mockResolvedValue([])

    const { savePlayoffBracketPick } = await import("@/lib/playoffs/playoffService")
    await expect(savePlayoffBracketPick({
      challengeId: "challenge-1",
      entryId: "entry-1",
      userId: "user-1",
      seriesId: "s1",
      pickTeamName: "Lakers",
    })).rejects.toThrow("Pick team must be one of the teams in this series")

    expect(pickUpsertMock).not.toHaveBeenCalled()
  })

  it("allows provider-synced later-round picks without earlier user picks when unlocked", async () => {
    entryFindUniqueMock.mockResolvedValue({ id: "entry-1", userId: "user-1", challengeId: "challenge-1" })
    seriesFindUniqueMock.mockResolvedValue({
      id: "s9",
      challengeId: "challenge-1",
      status: "scheduled",
      startsAt: null,
      homeTeamName: "Celtics",
      awayTeamName: "Knicks",
      challenge: { config: { lockRule: "series_start" } },
    })
    seriesFindManyMock.mockResolvedValue([
      {
        id: "s1",
        challengeId: "challenge-1",
        roundIndex: 1,
        seriesNumber: 1,
        homeTeamName: "Celtics",
        awayTeamName: "Hawks",
        sourceSeriesHome: null,
        sourceSeriesAway: null,
      },
      {
        id: "s2",
        challengeId: "challenge-1",
        roundIndex: 1,
        seriesNumber: 2,
        homeTeamName: "Knicks",
        awayTeamName: "76ers",
        sourceSeriesHome: null,
        sourceSeriesAway: null,
      },
      {
        id: "s9",
        challengeId: "challenge-1",
        roundIndex: 2,
        seriesNumber: 9,
        homeTeamName: "Celtics",
        awayTeamName: "Knicks",
        sourceSeriesHome: 1,
        sourceSeriesAway: 2,
      },
    ])
    pickFindManyMock.mockResolvedValue([])
    pickUpsertMock.mockResolvedValue({ id: "p9", seriesId: "s9", pickTeamName: "Celtics" })

    const { savePlayoffBracketPick } = await import("@/lib/playoffs/playoffService")
    await savePlayoffBracketPick({
      challengeId: "challenge-1",
      entryId: "entry-1",
      userId: "user-1",
      seriesId: "s9",
      pickTeamName: "Celtics",
    })

    expect(pickUpsertMock).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ seriesId: "s9", pickTeamName: "Celtics" }),
    }))
  })

  it("allows valid projected Conference Finals picks from saved semifinal picks in no-lock test pools", async () => {
    entryFindUniqueMock.mockResolvedValue({ id: "entry-1", userId: "user-1", challengeId: "challenge-1" })
    seriesFindUniqueMock.mockResolvedValue({
      id: "s13",
      challengeId: "challenge-1",
      status: "scheduled",
      startsAt: null,
      homeTeamName: "East Winner A",
      awayTeamName: "East Winner B",
      challenge: { config: { lockRule: "none" }, ownerUserId: "user-1", isTestMode: true },
    })
    seriesFindManyMock.mockResolvedValue([
      {
        id: "s9",
        challengeId: "challenge-1",
        roundIndex: 2,
        seriesNumber: 9,
        homeTeamName: "Celtics",
        awayTeamName: "Knicks",
        sourceSeriesHome: 1,
        sourceSeriesAway: 2,
      },
      {
        id: "s10",
        challengeId: "challenge-1",
        roundIndex: 2,
        seriesNumber: 10,
        homeTeamName: "Pacers",
        awayTeamName: "Cavaliers",
        sourceSeriesHome: 3,
        sourceSeriesAway: 4,
      },
      {
        id: "s13",
        challengeId: "challenge-1",
        roundIndex: 3,
        seriesNumber: 13,
        homeTeamName: "East Winner A",
        awayTeamName: "East Winner B",
        sourceSeriesHome: 9,
        sourceSeriesAway: 10,
      },
    ])
    pickFindManyMock.mockResolvedValue([
      { id: "p9", seriesId: "s9", pickTeamName: "Celtics" },
      { id: "p10", seriesId: "s10", pickTeamName: "Pacers" },
    ])
    pickUpsertMock.mockResolvedValue({ id: "p13", seriesId: "s13", pickTeamName: "Celtics" })

    const { savePlayoffBracketPick } = await import("@/lib/playoffs/playoffService")
    await savePlayoffBracketPick({
      challengeId: "challenge-1",
      entryId: "entry-1",
      userId: "user-1",
      seriesId: "s13",
      pickTeamName: "Celtics",
    })

    expect(pickUpsertMock).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ seriesId: "s13", pickTeamName: "Celtics" }),
    }))
  })

  it("rejects arbitrary projected Conference Finals team names", async () => {
    entryFindUniqueMock.mockResolvedValue({ id: "entry-1", userId: "user-1", challengeId: "challenge-1" })
    seriesFindUniqueMock.mockResolvedValue({
      id: "s13",
      challengeId: "challenge-1",
      status: "scheduled",
      startsAt: null,
      homeTeamName: "East Winner A",
      awayTeamName: "East Winner B",
      challenge: { config: { lockRule: "none" }, ownerUserId: "user-1", isTestMode: true },
    })
    seriesFindManyMock.mockResolvedValue([
      { id: "s9", challengeId: "challenge-1", roundIndex: 2, seriesNumber: 9, homeTeamName: "Celtics", awayTeamName: "Knicks", sourceSeriesHome: 1, sourceSeriesAway: 2 },
      { id: "s10", challengeId: "challenge-1", roundIndex: 2, seriesNumber: 10, homeTeamName: "Pacers", awayTeamName: "Cavaliers", sourceSeriesHome: 3, sourceSeriesAway: 4 },
      { id: "s13", challengeId: "challenge-1", roundIndex: 3, seriesNumber: 13, homeTeamName: "East Winner A", awayTeamName: "East Winner B", sourceSeriesHome: 9, sourceSeriesAway: 10 },
    ])
    pickFindManyMock.mockResolvedValue([
      { id: "p9", seriesId: "s9", pickTeamName: "Celtics" },
      { id: "p10", seriesId: "s10", pickTeamName: "Pacers" },
    ])

    const { savePlayoffBracketPick } = await import("@/lib/playoffs/playoffService")
    await expect(savePlayoffBracketPick({
      challengeId: "challenge-1",
      entryId: "entry-1",
      userId: "user-1",
      seriesId: "s13",
      pickTeamName: "Lakers",
    })).rejects.toThrow("Pick team must be one of the teams in this series")

    expect(pickUpsertMock).not.toHaveBeenCalled()
  })

  it("allows projected later-round pick from saved user pick when official winner differs", async () => {
    entryFindUniqueMock.mockResolvedValue({ id: "entry-1", userId: "user-1", challengeId: "challenge-1" })
    seriesFindUniqueMock.mockResolvedValue({
      id: "s9",
      challengeId: "challenge-1",
      status: "scheduled",
      startsAt: null,
      homeTeamName: "Winner S1",
      awayTeamName: "Winner S2",
      challenge: { config: { lockRule: "none" }, ownerUserId: "user-1", isTestMode: true },
    })
    seriesFindManyMock.mockResolvedValue([
      {
        id: "s1",
        challengeId: "challenge-1",
        roundIndex: 1,
        seriesNumber: 1,
        homeTeamName: "Boston Celtics",
        awayTeamName: "Philadelphia 76ers",
        winnerTeamName: "Philadelphia 76ers",
        sourceSeriesHome: null,
        sourceSeriesAway: null,
      },
      {
        id: "s2",
        challengeId: "challenge-1",
        roundIndex: 1,
        seriesNumber: 2,
        homeTeamName: "Knicks",
        awayTeamName: "Pacers",
        winnerTeamName: "Knicks",
        sourceSeriesHome: null,
        sourceSeriesAway: null,
      },
      {
        id: "s9",
        challengeId: "challenge-1",
        roundIndex: 2,
        seriesNumber: 9,
        homeTeamName: "Winner S1",
        awayTeamName: "Winner S2",
        sourceSeriesHome: 1,
        sourceSeriesAway: 2,
      },
    ])
    pickFindManyMock.mockResolvedValue([
      { id: "p1", seriesId: "s1", pickTeamName: "Boston Celtics" },
      { id: "p2", seriesId: "s2", pickTeamName: "Pacers" },
    ])
    pickUpsertMock.mockResolvedValue({ id: "p9", seriesId: "s9", pickTeamName: "Boston Celtics" })

    const { savePlayoffBracketPick } = await import("@/lib/playoffs/playoffService")
    await savePlayoffBracketPick({
      challengeId: "challenge-1",
      entryId: "entry-1",
      userId: "user-1",
      seriesId: "s9",
      pickTeamName: "Boston Celtics",
    })

    expect(pickUpsertMock).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ seriesId: "s9", pickTeamName: "Boston Celtics" }),
    }))
  })

  it("rejects official winner as later-round pick when no saved source pick exists", async () => {
    entryFindUniqueMock.mockResolvedValue({ id: "entry-1", userId: "user-1", challengeId: "challenge-1" })
    seriesFindUniqueMock.mockResolvedValue({
      id: "s9",
      challengeId: "challenge-1",
      status: "scheduled",
      startsAt: null,
      homeTeamName: "Winner S1",
      awayTeamName: "Winner S2",
      challenge: { config: { lockRule: "none" }, ownerUserId: "user-1", isTestMode: true },
    })
    seriesFindManyMock.mockResolvedValue([
      {
        id: "s1",
        challengeId: "challenge-1",
        roundIndex: 1,
        seriesNumber: 1,
        homeTeamName: "Boston Celtics",
        awayTeamName: "Philadelphia 76ers",
        winnerTeamName: "Philadelphia 76ers",
        sourceSeriesHome: null,
        sourceSeriesAway: null,
      },
      {
        id: "s2",
        challengeId: "challenge-1",
        roundIndex: 1,
        seriesNumber: 2,
        homeTeamName: "Knicks",
        awayTeamName: "Pacers",
        winnerTeamName: "Knicks",
        sourceSeriesHome: null,
        sourceSeriesAway: null,
      },
      {
        id: "s9",
        challengeId: "challenge-1",
        roundIndex: 2,
        seriesNumber: 9,
        homeTeamName: "Winner S1",
        awayTeamName: "Winner S2",
        sourceSeriesHome: 1,
        sourceSeriesAway: 2,
      },
    ])
    pickFindManyMock.mockResolvedValue([{ id: "p2", seriesId: "s2", pickTeamName: "Pacers" }])

    const { savePlayoffBracketPick } = await import("@/lib/playoffs/playoffService")
    await expect(savePlayoffBracketPick({
      challengeId: "challenge-1",
      entryId: "entry-1",
      userId: "user-1",
      seriesId: "s9",
      pickTeamName: "Philadelphia 76ers",
    })).rejects.toThrow("Pick earlier round winners first.")

    expect(pickUpsertMock).not.toHaveBeenCalled()
  })
})
