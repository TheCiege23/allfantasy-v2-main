import { beforeEach, describe, expect, it, vi } from "vitest"

const prismaMock = vi.hoisted(() => ({
  sportsPlayer: { count: vi.fn(), findMany: vi.fn() },
  playerIdentityMap: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
  sportsTeam: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
  teamAsset: { count: vi.fn(), findMany: vi.fn() },
}))

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

const SLEEPER = { provider: "Sleeper", playerField: "sleeperId", aliases: ["sleeper"] } as const

/** Builds `count` fake rows, each with a distinct externalId "player-0".."player-{count-1}". */
function playerRows(count: number, offset = 0) {
  return Array.from({ length: count }, (_, i) => ({ externalId: `player-${offset + i}` }))
}

function identityRows(count: number, offset = 0) {
  return Array.from({ length: count }, (_, i) => ({ sleeperId: `player-${offset + i}` }))
}

/** Mocks findMany to serve pages honestly from a fixed backing array, like a real DB would. */
function pagedMock(all: Array<Record<string, unknown>>) {
  return vi.fn(async (args: { skip?: number; take?: number }) => {
    const skip = args.skip ?? 0
    const take = args.take ?? all.length
    return all.slice(skip, skip + take)
  })
}

describe("buildProviderMappingAggregate — identity health pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.playerIdentityMap.groupBy.mockResolvedValue([])
    prismaMock.sportsTeam.groupBy.mockResolvedValue([])
    prismaMock.sportsTeam.count.mockResolvedValue(0)
    prismaMock.sportsTeam.findMany.mockResolvedValue([])
    prismaMock.teamAsset.count.mockResolvedValue(0)
    prismaMock.teamAsset.findMany.mockResolvedValue([])
  })

  it("THE ACTUAL BUG: a population under the old 10,000 cap still reports every real unmapped player", async () => {
    // Unremarkable case, but it is the one the bug silently got right by coincidence -- worth
    // pinning so a fix cannot regress the common (under-cap) path while fixing the rare one.
    const players = playerRows(50)
    const identity = identityRows(20) // only the first 20 players are mapped
    prismaMock.sportsPlayer.count.mockResolvedValue(50)
    prismaMock.sportsPlayer.findMany.mockImplementation(pagedMock(players))
    prismaMock.playerIdentityMap.count.mockResolvedValue(20)
    prismaMock.playerIdentityMap.findMany.mockImplementation(pagedMock(identity))

    const { buildProviderMappingAggregate } = await import("@/lib/sports-reporting/SportsIdentityHealthService")
    const result = await buildProviderMappingAggregate("NFL", SLEEPER)

    expect(result.providerPlayerRows).toBe(50)
    expect(result.unmappedProviderPlayers).toBe(30)
    expect(prismaMock.sportsPlayer.findMany).toHaveBeenCalledTimes(1)
  })

  it("THE ACTUAL BUG, REPRODUCED: a population over 10,000 no longer truncates the unmapped count", async () => {
    // Real shape of the NFL/Sleeper incident: true count 11,960, all mapped except the last 1,960
    // (indices 10,000-11,959), which sit ENTIRELY past the old take:10000 cap. The old code
    // would have examined only the first 10,000 -- all mapped -- and reported 0 unmapped, or
    // worse, an unrelated arbitrary figure depending on row order. The correct answer is exactly
    // the 1,960 the old cap could never see.
    const total = 11_960
    const players = playerRows(total)
    const identity = identityRows(10_000) // first 10,000 players are mapped; last 1,960 are not
    prismaMock.sportsPlayer.count.mockResolvedValue(total)
    prismaMock.sportsPlayer.findMany.mockImplementation(pagedMock(players))
    prismaMock.playerIdentityMap.count.mockResolvedValue(10_000)
    prismaMock.playerIdentityMap.findMany.mockImplementation(pagedMock(identity))

    const { buildProviderMappingAggregate } = await import("@/lib/sports-reporting/SportsIdentityHealthService")
    const result = await buildProviderMappingAggregate("NFL", SLEEPER)

    expect(result.providerPlayerRows).toBe(total)
    expect(result.mappedPlayerIds).toBe(10_000)
    expect(result.unmappedProviderPlayers).toBe(1_960)
  })

  it("pages a population larger than one page's worth, in more than one query", async () => {
    // 68,641 real rows (the NCAAF/Rolling Insights incident shape) at a 25,000 page size is
    // ceil(68641/25000) = 3 pages -- confirms multi-page fetching actually happens, not just
    // that the final count comes out right by coincidence of the mock.
    const total = 68_641
    const players = playerRows(total)
    prismaMock.sportsPlayer.count.mockResolvedValue(total)
    prismaMock.sportsPlayer.findMany.mockImplementation(pagedMock(players))
    prismaMock.playerIdentityMap.count.mockResolvedValue(0)
    prismaMock.playerIdentityMap.findMany.mockResolvedValue([])

    const { buildProviderMappingAggregate } = await import("@/lib/sports-reporting/SportsIdentityHealthService")
    const result = await buildProviderMappingAggregate("NCAAF", {
      provider: "Rolling Insights",
      playerField: "rollingInsightsId",
      aliases: ["rollinginsights", "rolling_insights"],
    } as const)

    expect(prismaMock.sportsPlayer.findMany).toHaveBeenCalledTimes(3)
    expect(result.providerPlayerRows).toBe(total)
    expect(result.unmappedProviderPlayers).toBe(total) // none mapped in this fixture
  })

  it("takes exactly one query when the population exactly fills one page", async () => {
    // pages = ceil(totalRows / pageSize) is computed from the COUNT already in hand, not from
    // probing "did the last page come back full" -- so an exact page size needs no extra call.
    const total = 25_000 // exactly one page at the default page size
    const players = playerRows(total)
    prismaMock.sportsPlayer.count.mockResolvedValue(total)
    prismaMock.sportsPlayer.findMany.mockImplementation(pagedMock(players))
    prismaMock.playerIdentityMap.count.mockResolvedValue(0)
    prismaMock.playerIdentityMap.findMany.mockResolvedValue([])

    const { buildProviderMappingAggregate } = await import("@/lib/sports-reporting/SportsIdentityHealthService")
    const result = await buildProviderMappingAggregate("NFL", SLEEPER)

    expect(prismaMock.sportsPlayer.findMany).toHaveBeenCalledTimes(1)
    expect(result.providerPlayerRows).toBe(total)
  })

  it("every findMany call orders by id, so offset pagination cannot skip or duplicate rows", async () => {
    const players = playerRows(30_000)
    prismaMock.sportsPlayer.count.mockResolvedValue(30_000)
    prismaMock.sportsPlayer.findMany.mockImplementation(pagedMock(players))
    prismaMock.playerIdentityMap.count.mockResolvedValue(0)
    prismaMock.playerIdentityMap.findMany.mockResolvedValue([])

    const { buildProviderMappingAggregate } = await import("@/lib/sports-reporting/SportsIdentityHealthService")
    await buildProviderMappingAggregate("NFL", SLEEPER)

    for (const call of prismaMock.sportsPlayer.findMany.mock.calls) {
      expect(call[0].orderBy).toEqual({ id: "asc" })
    }
  })
})
