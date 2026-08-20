import { beforeEach, describe, expect, it, vi } from "vitest"

const prismaFindUniqueMock = vi.hoisted(() => vi.fn())
const prismaPickManyMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    playoffBracketChallenge: {
      findUnique: prismaFindUniqueMock,
    },
    playoffBracketPick: {
      findMany: prismaPickManyMock,
    },
  },
}))

describe("getPlayoffBracketView series feeders", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    prismaPickManyMock.mockResolvedValue([])
    prismaFindUniqueMock.mockResolvedValue({
      id: "c1",
      name: "Pool",
      ownerUserId: "u1",
      sport: "nhl",
      seasonYear: 2026,
      status: "open",
      isTestMode: false,
      owner: {},
      entries: [{ id: "e1", name: "B1", userId: "u1", user: {}, createdAt: new Date() }],
      series: [
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
          nextSeriesNumber: 13,
          nextSeriesSlot: "home",
          sourceSeriesHome: 1,
          sourceSeriesAway: 2,
          createdAt: new Date(),
        },
      ],
    })
  })

  it("exposes sourceSeriesHome / sourceSeriesAway on each series row for bracket projection", async () => {
    const { getPlayoffBracketView } = await import("@/lib/playoffs/playoffService")
    const view = await getPlayoffBracketView({
      challengeId: "c1",
      user: { id: "u1" },
      requestedEntryId: "e1",
    })

    expect(view?.series?.[0]).toMatchObject({
      seriesNumber: 9,
      sourceSeriesHome: 1,
      sourceSeriesAway: 2,
    })
  })
})
