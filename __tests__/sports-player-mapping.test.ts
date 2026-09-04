import { beforeEach, describe, expect, it, vi } from "vitest"

const prismaMock = vi.hoisted(() => ({
  playerIdentityMap: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  sportsPlayer: {
    findFirst: vi.fn(),
  },
  sportsTeam: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
}))

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

describe("sports provider player/team mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.playerIdentityMap.findFirst.mockResolvedValue(null)
    prismaMock.playerIdentityMap.findMany.mockResolvedValue([])
    prismaMock.sportsPlayer.findFirst.mockResolvedValue(null)
    prismaMock.sportsTeam.findFirst.mockResolvedValue(null)
    prismaMock.sportsTeam.findMany.mockResolvedValue([])
  })

  it("uses exact provider id before normalized-name fallback", async () => {
    prismaMock.playerIdentityMap.findFirst.mockResolvedValueOnce({
      id: "identity-1",
      sleeperId: "sleeper-1",
      canonicalName: "Patrick Mahomes",
    })

    const { resolveProviderPlayerIdentity } = await import("@/lib/sports-reporting/PlayerGameLogImportService")
    const result = await resolveProviderPlayerIdentity({
      sport: "NFL",
      provider: "sleeper",
      providerPlayerId: "sleeper-1",
      playerName: "Patrick Mahomes",
      team: "KC",
    })

    expect(result).toEqual({
      ok: true,
      cachePlayerId: "sleeper-1",
      canonicalIdentityId: "identity-1",
      matchType: "provider_id",
    })
    expect(prismaMock.playerIdentityMap.findMany).not.toHaveBeenCalled()
  })

  it("flags ambiguous normalized-name matches instead of silently mapping the wrong player", async () => {
    prismaMock.playerIdentityMap.findMany.mockResolvedValueOnce([
      { id: "identity-1", sleeperId: "p-1", canonicalName: "Mike Williams" },
      { id: "identity-2", sleeperId: "p-2", canonicalName: "Mike Williams" },
    ])

    const { resolveProviderPlayerIdentity } = await import("@/lib/sports-reporting/PlayerGameLogImportService")
    const result = await resolveProviderPlayerIdentity({
      sport: "NFL",
      provider: "sleeper",
      providerPlayerId: "unknown-provider-id",
      playerName: "Mike Williams",
    })

    expect(result).toEqual({
      ok: false,
      reason: "ambiguous",
      candidates: ["Mike Williams", "Mike Williams"],
    })
  })

  it("maps teams by provider id or team abbreviation and reports unmapped teams", async () => {
    prismaMock.sportsTeam.findFirst.mockResolvedValueOnce({
      id: "team-1",
      shortName: "KC",
      name: "Kansas City Chiefs",
    })

    const { resolveProviderTeamIdentity } = await import("@/lib/sports-reporting/PlayerGameLogImportService")
    await expect(
      resolveProviderTeamIdentity({
        sport: "NFL",
        provider: "sleeper",
        providerTeamId: "KC",
        team: "KC",
      }),
    ).resolves.toEqual({
      ok: true,
      teamCode: "KC",
      teamId: "team-1",
      matchType: "provider_id",
    })

    prismaMock.sportsTeam.findFirst.mockResolvedValueOnce(null)
    prismaMock.sportsTeam.findMany.mockResolvedValueOnce([])
    await expect(
      resolveProviderTeamIdentity({
        sport: "NFL",
        provider: "sleeper",
        team: "Mystery Team",
      }),
    ).resolves.toEqual({ ok: false, reason: "unmapped" })
  })
})
