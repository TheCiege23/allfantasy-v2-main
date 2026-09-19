import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Which SEASON a standings payload is filed under, per sport.
 *
 * This is not a formatting detail — the season is part of the cache key
 * (`<SPORT>:standings:<season>:<abbrev>`), so getting it wrong files live
 * standings where no reader will look for them. The MLB cases below are
 * regression cover for two measured provider behaviours that pull in opposite
 * directions:
 *
 *   - the un-parameterised MLB endpoint reports next year's `season.year`
 *     while serving the season currently being played, so the payload cannot
 *     be trusted; and
 *   - a season that has not started yet returns ZERO rows, so the clock cannot
 *     be trusted either once the season is over.
 */

const upsert = vi.hoisted(() => vi.fn())

vi.mock("server-only", () => ({}))
vi.mock("@/lib/prisma", () => ({ prisma: { sportsDataCache: { upsert } } }))

function entry(abbrev: string, wins: number, losses: number, seed?: number) {
  return {
    team: { abbreviation: abbrev, displayName: `${abbrev} Club`, logos: [{ href: "x" }] },
    stats: [
      { name: "wins", value: wins },
      { name: "losses", value: losses },
      ...(seed == null ? [] : [{ name: "playoffSeed", value: seed }]),
    ],
  }
}

/** A payload shaped like ESPN's: named groups, entries nested under children. */
function payload(seasonYear: number, groups: Array<{ name: string; entries: unknown[] }>) {
  return {
    season: { year: seasonYear },
    children: groups.map((g) => ({ name: g.name, standings: { entries: g.entries } })),
  }
}

const MLB_2026 = () =>
  payload(2027, [
    { name: "American League", entries: [entry("TB", 93, 60, 1), entry("NYY", 89, 64, 4)] },
    { name: "National League", entries: [entry("MIL", 96, 58, 1)] },
  ])

function mockFetchBySeason(handler: (season: string | null) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const season = new URL(String(input)).searchParams.get("season")
      const body = handler(season)
      return { ok: true, json: async () => body } as unknown as Response
    }),
  )
}

function keysWritten() {
  return upsert.mock.calls.map((call) => call[0].where.cacheKey)
}

function fetchedUrls() {
  return (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]))
}

describe("espn standings — season source", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsert.mockResolvedValue({})
  })

  it("exposes MLB as a supported standings sport", async () => {
    const { espnHasStandings } = await import("@/lib/standings/espnStandings")
    expect(espnHasStandings("MLB")).toBe(true)
    expect(espnHasStandings("NFL")).toBe(true)
    expect(espnHasStandings("CRICKET")).toBe(false)
  })

  /*
   * The football request is the one already verified live against ESPN. It must
   * stay byte-identical: no season parameter, season read off the payload.
   */
  it("keeps the football request unparameterised and trusts its payload season", async () => {
    mockFetchBySeason(() => payload(2026, [{ name: "AFC", entries: [entry("KC", 12, 3)] }]))
    const { syncEspnStandingsToDb } = await import("@/lib/standings/espnStandings")

    const result = await syncEspnStandingsToDb({ sport: "NFL", now: new Date("2027-01-15T00:00:00Z") })

    expect(fetchedUrls()).toEqual([expect.not.stringContaining("season=")])
    expect(result.written).toBe(1)
    // January 2027, but the payload says 2026 and football seasons span years.
    expect(keysWritten()).toEqual(["NFL:standings:2026:KC"])
  })

  /*
   * The trap: ESPN answers the bare MLB endpoint with next year's season.year
   * while serving standings that are still being played. Trusting it would file
   * the live 2026 season under 2026... no: under 2027, where nothing looks.
   */
  it("ignores the MLB payload season and files under the year actually being played", async () => {
    mockFetchBySeason(() => MLB_2026())
    const { syncEspnStandingsToDb } = await import("@/lib/standings/espnStandings")

    const result = await syncEspnStandingsToDb({ sport: "MLB", now: new Date("2026-09-19T00:00:00Z") })

    expect(result.written).toBe(3)
    // The payload said 2027. Every key must say 2026.
    expect(keysWritten()).toEqual([
      "MLB:standings:2026:TB",
      "MLB:standings:2026:NYY",
      "MLB:standings:2026:MIL",
    ])
    expect(keysWritten().some((k) => k.includes("2027"))).toBe(false)
  })

  /*
   * And the other direction: in the offseason the current calendar year is a
   * season that has not started, which ESPN answers with zero rows. Writing
   * nothing would trip the route's zero-rows-is-a-failure rule on every fire
   * for a third of the year.
   */
  it("falls back to the previous season when the current one has not started", async () => {
    mockFetchBySeason((season) =>
      season === "2027"
        ? payload(2027, [{ name: "American League", entries: [] }])
        : payload(2026, [{ name: "American League", entries: [entry("TB", 93, 69, 1)] }]),
    )
    const { syncEspnStandingsToDb } = await import("@/lib/standings/espnStandings")

    const result = await syncEspnStandingsToDb({ sport: "MLB", now: new Date("2027-01-10T00:00:00Z") })

    // It asked for 2027 first, found it empty, then asked for 2026.
    expect(fetchedUrls()).toEqual([
      expect.stringContaining("season=2027"),
      expect.stringContaining("season=2026"),
    ])
    expect(result.written).toBe(1)
    expect(keysWritten()).toEqual(["MLB:standings:2026:TB"])
  })

  it("does not fall back when the current season has rows", async () => {
    mockFetchBySeason(() => MLB_2026())
    const { syncEspnStandingsToDb } = await import("@/lib/standings/espnStandings")

    await syncEspnStandingsToDb({ sport: "MLB", now: new Date("2026-09-19T00:00:00Z") })

    expect(fetchedUrls()).toHaveLength(1)
  })

  it("lets an explicit season win, for the backfill path", async () => {
    mockFetchBySeason(() => payload(2026, [{ name: "American League", entries: [entry("NYY", 94, 68, 4)] }]))
    const { syncEspnStandingsToDb } = await import("@/lib/standings/espnStandings")

    await syncEspnStandingsToDb({ sport: "MLB", season: "2025", now: new Date("2026-09-19T00:00:00Z") })

    expect(fetchedUrls()).toEqual([expect.stringContaining("season=2025")])
    expect(keysWritten()).toEqual(["MLB:standings:2025:NYY"])
  })

  /*
   * playoffSeed is the whole reason this feed can seed a bracket: ESPN applies
   * MLB's division-winner-first rule, which is otherwise a pile of tiebreakers
   * to reimplement. It is stored as `position`.
   */
  it("persists the playoff seed and the league group", async () => {
    mockFetchBySeason(() => MLB_2026())
    const { syncEspnStandingsToDb } = await import("@/lib/standings/espnStandings")

    await syncEspnStandingsToDb({ sport: "MLB", now: new Date("2026-09-19T00:00:00Z") })

    const tb = upsert.mock.calls.find((c) => c[0].where.cacheKey.endsWith(":TB"))?.[0].create.data
    expect(tb).toMatchObject({
      team: "TB",
      position: 1,
      won: 93,
      lost: 60,
      conference: "American League",
      sport: "MLB",
      source: "espn",
    })
  })
})
