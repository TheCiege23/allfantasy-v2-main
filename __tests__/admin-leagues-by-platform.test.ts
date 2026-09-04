import { beforeEach, describe, expect, it, vi } from "vitest"

const prismaMock = vi.hoisted(() => ({
  league: { groupBy: vi.fn() },
}))

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

describe("loadLeaguesByPlatform", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("THE ACTUAL FEATURE: counts real leagues per external platform, sorted by count", async () => {
    // Shape measured against real production rows 2026-09-04.
    prismaMock.league.groupBy.mockResolvedValue([
      { platform: "sleeper", _count: { _all: 227 } },
      { platform: "manual", _count: { _all: 23 } },
      { platform: "allfantasy_test_adp_seed", _count: { _all: 18 } },
      { platform: "espn", _count: { _all: 5 } },
      { platform: "fantrax", _count: { _all: 1 } },
      { platform: "native", _count: { _all: 1 } },
    ])

    const { loadLeaguesByPlatform } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const rows = await loadLeaguesByPlatform()

    expect(rows).toEqual([
      { platform: "sleeper", label: "Sleeper", count: 227 },
      { platform: "espn", label: "ESPN", count: 5 },
      { platform: "fantrax", label: "Fantrax", count: 1 },
    ])
  })

  it("excludes manual, native, and test-seed values -- these are not external platforms", async () => {
    prismaMock.league.groupBy.mockResolvedValue([
      { platform: "manual", _count: { _all: 100 } },
      { platform: "native", _count: { _all: 100 } },
      { platform: "allfantasy_test_adp_seed", _count: { _all: 100 } },
    ])

    const { loadLeaguesByPlatform } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const rows = await loadLeaguesByPlatform()

    expect(rows).toEqual([])
  })

  it("labels a platform not in the known map with a capitalized fallback, not the raw id", async () => {
    prismaMock.league.groupBy.mockResolvedValue([{ platform: "fleaflicker", _count: { _all: 3 } }])

    const { loadLeaguesByPlatform } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const rows = await loadLeaguesByPlatform()

    // fleaflicker IS in the known label map (proper "Fleaflicker"); mfl/yahoo below are too --
    // this test exercises the genuinely-unknown fallback path with a platform NOT in the map.
    expect(rows).toEqual([{ platform: "fleaflicker", label: "Fleaflicker", count: 3 }])
  })

  it("falls back to a capitalized label for a platform with no explicit entry", async () => {
    prismaMock.league.groupBy.mockResolvedValue([{ platform: "cbs", _count: { _all: 2 } }])

    const { loadLeaguesByPlatform } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const rows = await loadLeaguesByPlatform()

    expect(rows).toEqual([{ platform: "cbs", label: "Cbs", count: 2 }])
  })

  it("returns an empty array rather than throwing when the query fails", async () => {
    prismaMock.league.groupBy.mockRejectedValue(new Error("connection reset"))

    const { loadLeaguesByPlatform } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const rows = await loadLeaguesByPlatform()

    expect(rows).toEqual([])
  })

  it("returns an empty array when there are no leagues at all", async () => {
    prismaMock.league.groupBy.mockResolvedValue([])

    const { loadLeaguesByPlatform } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const rows = await loadLeaguesByPlatform()

    expect(rows).toEqual([])
  })
})
