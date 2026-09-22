import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * NBA/NHL standings: which season, and which season TYPE.
 *
 * Measured 2026-09-22 against ESPN's v2 standings: it names a split-year season by the year it
 * ENDS (`2027` = 2026-27) while this repo keys by the year it STARTS, and the un-parameterised
 * request serves the PRESEASON (NHL: 22 league-wide wins in September, from exhibitions).
 */

const upsert = vi.hoisted(() => vi.fn())

vi.mock("server-only", () => ({}))
vi.mock("@/lib/prisma", () => ({ prisma: { sportsDataCache: { upsert } } }))

function entry(abbrev: string, wins: number, losses: number, otLosses?: number) {
  return {
    team: { abbreviation: abbrev, displayName: `${abbrev} Club`, logos: [{ href: "x" }] },
    stats: [
      { name: "wins", value: wins },
      { name: "losses", value: losses },
      ...(otLosses == null ? [] : [{ name: "otLosses", value: otLosses }]),
    ],
  }
}

function payload(entries: unknown[]) {
  return { children: [{ name: "Eastern Conference", standings: { entries } }] }
}

/** Serves by `season` (ESPN's end-year) and records the season type asked for. */
function mockFetch(bySeason: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const season = new URL(String(input)).searchParams.get("season") ?? "none"
      return { ok: true, json: async () => bySeason[season] ?? { children: [] } } as unknown as Response
    }),
  )
}

const urls = () =>
  (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => new URL(String(c[0])))
const keys = () => upsert.mock.calls.map((call) => call[0].where.cacheKey)

describe("espn standings — split-year sports", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsert.mockResolvedValue({})
  })

  it("mid-season: asks ESPN for the regular season by END year, files it under the START year", async () => {
    mockFetch({ "2027": payload([entry("BOS", 20, 10, 3), entry("MTL", 18, 12, 1)]) })
    const { syncEspnStandingsToDb } = await import("@/lib/standings/espnStandings")
    const r = await syncEspnStandingsToDb({ sport: "NHL", now: new Date("2026-12-15T12:00:00Z") })

    expect(urls()[0]?.searchParams.get("season")).toBe("2027")
    expect(urls()[0]?.searchParams.get("seasontype")).toBe("2")
    expect(keys()).toEqual(["NHL:standings:2026:BOS", "NHL:standings:2026:MTL"])
    expect(upsert.mock.calls[0][0].create.data).toMatchObject({ won: 20, lost: 10, otLost: 3, season: "2026" })
    expect(r.written).toBe(2)
  })

  it("January still belongs to the season that started the previous autumn", async () => {
    mockFetch({ "2027": payload([entry("BOS", 30, 12)]) })
    const { syncEspnStandingsToDb } = await import("@/lib/standings/espnStandings")
    await syncEspnStandingsToDb({ sport: "NBA", now: new Date("2027-01-20T12:00:00Z") })
    expect(keys()).toEqual(["NBA:standings:2026:BOS"])
  })

  it("before tip-off (every row 0-0) falls back to the last completed season", async () => {
    mockFetch({
      "2027": payload([entry("ATL", 0, 0), entry("BOS", 0, 0)]),
      "2026": payload([entry("ATL", 40, 42), entry("BOS", 61, 21)]),
    })
    const { syncEspnStandingsToDb } = await import("@/lib/standings/espnStandings")
    await syncEspnStandingsToDb({ sport: "NBA", now: new Date("2026-09-22T12:00:00Z") })

    expect(urls().map((u) => u.searchParams.get("season"))).toEqual(["2027", "2026"])
    expect(urls().every((u) => u.searchParams.get("seasontype") === "2")).toBe(true)
    expect(keys()).toEqual(["NBA:standings:2025:ATL", "NBA:standings:2025:BOS"])
  })

  it("an explicit backfill season is read in the repo's start-year convention", async () => {
    mockFetch({ "2025": payload([entry("DAL", 50, 32)]) })
    const { syncEspnStandingsToDb } = await import("@/lib/standings/espnStandings")
    await syncEspnStandingsToDb({ sport: "NBA", season: "2024" })
    expect(urls()[0]?.searchParams.get("season")).toBe("2025")
    expect(keys()).toEqual(["NBA:standings:2024:DAL"])
  })

  it("football requests stay byte-identical: no seasontype parameter", async () => {
    mockFetch({ none: { season: { year: 2026 }, ...payload([entry("KC", 2, 1)]) } })
    const { syncEspnStandingsToDb } = await import("@/lib/standings/espnStandings")
    await syncEspnStandingsToDb({ sport: "NFL", now: new Date("2026-09-22T12:00:00Z") })
    expect(urls()[0]?.search).toBe("")
    expect(keys()).toEqual(["NFL:standings:2026:KC"])
  })
})
