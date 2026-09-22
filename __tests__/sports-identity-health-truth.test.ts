import { beforeEach, describe, expect, it, vi } from "vitest"

/*
 * The /admin identity & image health panel reported numbers that were the panel's own
 * measuring errors, not data problems (all measured against production on 2026-09-22):
 *   - NFL Sleeper "11,960 unmapped" — 8,964 were mapped; the ids differ by a `sleeper:` prefix
 *   - every provider team "unmapped" — the reference table (team_assets) is empty
 *   - ~50 of 70 provider rows red "Missing" for pairs that hold no data at all (CFBD×NFL)
 *   - "24,894 NFL players missing headshots" — 28 people, counted per person
 * Each test below pins one of those, and fails if the fix is reverted.
 */

const prismaMock = vi.hoisted(() => ({
  sportsPlayer: { count: vi.fn(), findMany: vi.fn() },
  sportsPlayerRecord: { count: vi.fn(), findMany: vi.fn() },
  playerIdentityMap: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
  sportsTeam: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
  teamAsset: { count: vi.fn(), findMany: vi.fn() },
}))

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import {
  buildProviderMappingAggregate,
  buildSportsIdentityHealthSnapshot,
  getSportsIdentityHealthSnapshot,
  peopleHeadshotCoverage,
  resetSportsIdentityHealthSnapshotCache,
  providerLocalId,
  type SportsIdentityHealthAggregate,
} from "@/lib/sports-reporting/SportsIdentityHealthService"

function paged(all: Array<Record<string, unknown>>) {
  return vi.fn(async (args: { skip?: number; take?: number }) => {
    const skip = args.skip ?? 0
    return all.slice(skip, skip + (args.take ?? all.length))
  })
}

function aggregate(overrides: Partial<SportsIdentityHealthAggregate> = {}): SportsIdentityHealthAggregate {
  return { id: "nfl", sport: "NFL", label: "NFL", playerCount: 100, ...overrides }
}

describe("providerLocalId", () => {
  it("strips a prefix that names this provider", () => {
    expect(providerLocalId("sleeper:3694", ["sleeper"])).toBe("3694")
    expect(providerLocalId("SLEEPER:3694", ["sleeper"])).toBe("3694")
  })

  it("leaves another provider's prefix and plain ids alone", () => {
    expect(providerLocalId("name:aj brown", ["sleeper"])).toBe("name:aj brown")
    expect(providerLocalId("3694", ["sleeper"])).toBe("3694")
  })
})

describe("buildProviderMappingAggregate — measuring against the right keys", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.playerIdentityMap.groupBy.mockResolvedValue([])
    prismaMock.sportsTeam.groupBy.mockResolvedValue([])
  })

  it("matches Sleeper's prefixed externalIds to the identity map's bare ids", async () => {
    const players = [{ externalId: "sleeper:1" }, { externalId: "sleeper:2" }, { externalId: "sleeper:3" }]
    prismaMock.sportsPlayer.count.mockResolvedValue(3)
    prismaMock.sportsPlayer.findMany.mockImplementation(paged(players))
    prismaMock.playerIdentityMap.count.mockResolvedValue(2)
    prismaMock.playerIdentityMap.findMany.mockImplementation(paged([{ sleeperId: "1" }, { sleeperId: "2" }]))
    prismaMock.sportsTeam.count.mockResolvedValue(0)
    prismaMock.sportsTeam.findMany.mockResolvedValue([])
    prismaMock.teamAsset.count.mockResolvedValue(0)
    prismaMock.teamAsset.findMany.mockResolvedValue([])

    const result = await buildProviderMappingAggregate("NFL", {
      provider: "Sleeper",
      playerField: "sleeperId",
      aliases: ["sleeper"],
    } as never)

    expect(result.unmappedProviderPlayers).toBe(1)
  })

  it("does not claim a team measurement when the team reference table is empty", async () => {
    prismaMock.sportsPlayer.count.mockResolvedValue(0)
    prismaMock.sportsPlayer.findMany.mockResolvedValue([])
    prismaMock.playerIdentityMap.count.mockResolvedValue(0)
    prismaMock.playerIdentityMap.findMany.mockResolvedValue([])
    prismaMock.sportsTeam.count.mockResolvedValue(32)
    prismaMock.sportsTeam.findMany.mockImplementation(
      paged(Array.from({ length: 32 }, (_, i) => ({ externalId: `t${i}`, name: `Team ${i}`, shortName: `T${i}` })))
    )
    prismaMock.teamAsset.count.mockResolvedValue(0)
    prismaMock.teamAsset.findMany.mockResolvedValue([])

    const result = await buildProviderMappingAggregate("NFL", {
      provider: "Rolling Insights",
      playerField: "rollingInsightsId",
      aliases: ["rolling_insights"],
    } as never)

    expect(result.teamMappingMeasured).toBe(false)
  })
})

describe("buildSportsIdentityHealthSnapshot — provider rows", () => {
  it("marks a provider that holds nothing for a sport not_applicable, and keeps it out of the totals", () => {
    const snapshot = buildSportsIdentityHealthSnapshot({
      rows: [
        aggregate({
          providerMappings: [
            { provider: "CFBD", providerPlayerRows: 0, providerTeamRows: 0, mappedPlayerIds: 0 },
            { provider: "Sleeper", providerPlayerRows: 10, mappedPlayerIds: 8, unmappedProviderPlayers: 2 },
          ],
        }),
      ],
    })
    const cfbd = snapshot.providerRows.find((row) => row.provider === "CFBD")
    expect(cfbd?.status).toBe("not_applicable")
    expect(snapshot.summary.providerMappingProblems).toBe(2)
  })

  it("keeps a provider with mapped ids but no rows as a real row, not n/a", () => {
    const snapshot = buildSportsIdentityHealthSnapshot({
      rows: [aggregate({ providerMappings: [{ provider: "ESPN", providerPlayerRows: 0, mappedPlayerIds: 488 }] })],
    })
    expect(snapshot.providerRows[0]?.status).not.toBe("not_applicable")
  })

  it("reports a MEASURED zero as zero instead of re-estimating it", () => {
    const snapshot = buildSportsIdentityHealthSnapshot({
      rows: [
        aggregate({
          providerMappings: [
            { provider: "Sleeper", providerPlayerRows: 100, mappedPlayerIds: 60, unmappedProviderPlayers: 0 },
          ],
        }),
      ],
    })
    expect(snapshot.providerRows[0]?.unmappedProviderPlayers).toBe(0)
  })

  it("counts no unmapped teams when team mapping was not measured", () => {
    const snapshot = buildSportsIdentityHealthSnapshot({
      rows: [
        aggregate({
          providerMappings: [
            { provider: "Rolling Insights", providerTeamRows: 32, mappedTeamRows: 0, unmappedProviderTeams: 32, teamMappingMeasured: false },
          ],
        }),
      ],
    })
    expect(snapshot.providerRows[0]?.unmappedProviderTeams).toBe(0)
    expect(snapshot.providerRows[0]?.teamMappingMeasured).toBe(false)
    expect(snapshot.summary.providerMappingProblems).toBe(0)
  })
})

describe("buildSportsIdentityHealthSnapshot — headshots per person", () => {
  it("uses the per-person count and its own denominator when measured", () => {
    const snapshot = buildSportsIdentityHealthSnapshot({
      rows: [
        aggregate({
          playersMissingHeadshots: 24_000,
          playerRecordsMissingHeadshots: 894,
          peopleMissingHeadshots: 28,
          peopleCount: 12_218,
        }),
      ],
    })
    expect(snapshot.imageRows[0]?.playersMissingHeadshots).toBe(28)
    expect(snapshot.imageRows[0]?.playersAudited).toBe(12_218)
  })

  it("falls back to the per-row count when the per-person read did not complete", () => {
    const snapshot = buildSportsIdentityHealthSnapshot({
      rows: [aggregate({ playersMissingHeadshots: 40, playerRecordsMissingHeadshots: 2, peopleMissingHeadshots: null })],
    })
    expect(snapshot.imageRows[0]?.playersMissingHeadshots).toBe(42)
  })
})

describe("peopleHeadshotCoverage", () => {
  beforeEach(() => vi.clearAllMocks())

  function serve(players: Array<Record<string, unknown>>, records: Array<Record<string, unknown>> = []) {
    prismaMock.sportsPlayer.count.mockResolvedValue(players.length)
    prismaMock.sportsPlayer.findMany.mockImplementation(paged(players))
    prismaMock.sportsPlayerRecord.count.mockResolvedValue(records.length)
    prismaMock.sportsPlayerRecord.findMany.mockImplementation(paged(records))
  }

  it("counts a person as covered when ANY provider holds their photo, across name spellings", async () => {
    serve([
      { name: "A.J. Brown", imageUrl: null, source: "rolling_insights" },
      { name: "AJ Brown", imageUrl: "https://img/aj.png", source: "thesportsdb" },
      { name: "Nobody Pictured", imageUrl: null, source: "rolling_insights" },
    ])
    expect(await peopleHeadshotCoverage("MLB")).toEqual({ people: 2, missing: 1 })
  })

  it("treats a Sleeper id as a photo source for NFL only", async () => {
    serve([{ name: "Some Player", imageUrl: null, sleeperId: "4034", source: "rolling_insights" }])
    expect(await peopleHeadshotCoverage("NFL")).toEqual({ people: 1, missing: 0 })
    serve([{ name: "Some Player", imageUrl: null, sleeperId: "4034", source: "rolling_insights" }])
    expect(await peopleHeadshotCoverage("NBA")).toEqual({ people: 1, missing: 1 })
  })

  it("reads sports_players headshots too", async () => {
    serve([{ name: "Rookie Guy", imageUrl: null, source: "rolling_insights" }], [
      { name: "Rookie Guy", headshotUrl: null, headshotUrlSm: "https://img/sm.png", headshotUrlLg: null },
    ])
    expect(await peopleHeadshotCoverage("NHL")).toEqual({ people: 1, missing: 0 })
  })

  it("returns null rather than a partial count when a read comes back short", async () => {
    prismaMock.sportsPlayer.count.mockResolvedValue(5)
    prismaMock.sportsPlayer.findMany.mockRejectedValue(new Error("connection reset"))
    prismaMock.sportsPlayerRecord.count.mockResolvedValue(0)
    prismaMock.sportsPlayerRecord.findMany.mockResolvedValue([])
    expect(await peopleHeadshotCoverage("NFL")).toBeNull()
  })
})

describe("getSportsIdentityHealthSnapshot — cached for the page's one-minute refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSportsIdentityHealthSnapshotCache()
    for (const model of Object.values(prismaMock)) {
      for (const fn of Object.values(model)) (fn as ReturnType<typeof vi.fn>).mockResolvedValue(0)
    }
    prismaMock.sportsPlayer.findMany.mockResolvedValue([])
    prismaMock.sportsPlayerRecord.findMany.mockResolvedValue([])
    prismaMock.playerIdentityMap.findMany.mockResolvedValue([])
    prismaMock.playerIdentityMap.groupBy.mockResolvedValue([])
    prismaMock.sportsTeam.findMany.mockResolvedValue([])
    prismaMock.sportsTeam.groupBy.mockResolvedValue([])
    prismaMock.teamAsset.findMany.mockResolvedValue([])
  })

  it("runs the audit once for two page renders, and again for an explicit refresh", async () => {
    await getSportsIdentityHealthSnapshot()
    const afterFirst = prismaMock.sportsPlayer.count.mock.calls.length
    expect(afterFirst).toBeGreaterThan(0)

    await getSportsIdentityHealthSnapshot()
    expect(prismaMock.sportsPlayer.count.mock.calls.length).toBe(afterFirst)

    await getSportsIdentityHealthSnapshot({ fresh: true })
    expect(prismaMock.sportsPlayer.count.mock.calls.length).toBe(afterFirst * 2)
  })
})
