import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Turning `AL1` into a real club is the step that lets an MLB pool exist before
 * game one — and it is also the step that can quietly break every pick already
 * made, because `PlayoffBracketPick.pickTeamName` is a plain string compared by
 * value at scoring time. These tests hold both halves.
 */

const db = vi.hoisted(() => ({
  sportsDataCache: { findMany: vi.fn() },
  playoffBracketChallenge: { findUnique: vi.fn(), findMany: vi.fn() },
  playoffBracketSeries: { findMany: vi.fn(), update: vi.fn() },
  playoffBracketPick: { updateMany: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/prisma", () => ({ prisma: db }))

/*
 * `won`/`lost` sum to a COMPLETE MLB season by default. Seeding now refuses a
 * field whose regular season is still running, so a fixture that omitted them
 * would make every test here assert the refusal instead of the behaviour it
 * names — a whole suite passing vacuously.
 */
const cacheRow = (teamName: string, conference: string, position: number, gamesPlayed = 162) => ({
  data: {
    teamName,
    conference,
    position,
    team: teamName.slice(0, 3).toUpperCase(),
    won: Math.ceil(gamesPlayed / 2),
    lost: Math.floor(gamesPlayed / 2),
  },
})

/** The AL half of a real 2026 field, as import-standings would have cached it. */
const AL_FIELD = [
  cacheRow("Tampa Bay Rays", "American League", 1),
  cacheRow("Cleveland Guardians", "American League", 2),
  cacheRow("Houston Astros", "American League", 3),
  cacheRow("New York Yankees", "American League", 4),
  cacheRow("Boston Red Sox", "American League", 5),
  cacheRow("Chicago White Sox", "American League", 6),
]

function series(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "s1",
    conference: "al",
    homeSeed: 1,
    awaySeed: 4,
    homeTeamName: "AL1",
    awayTeamName: "AL4",
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db))
  db.playoffBracketSeries.update.mockResolvedValue({})
  db.playoffBracketPick.updateMany.mockResolvedValue({ count: 0 })
  db.playoffBracketChallenge.findUnique.mockResolvedValue({ id: "c1", sport: "mlb", seasonYear: 2026 })
})

describe("resolvePlayoffSeedField", () => {
  it("reads the cached field and keys it by league and seed", async () => {
    db.sportsDataCache.findMany.mockResolvedValue(AL_FIELD)
    const { resolvePlayoffSeedField } = await import("@/lib/playoffs/playoffSeeding")

    const field = await resolvePlayoffSeedField("mlb", 2026)

    expect(db.sportsDataCache.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { cacheKey: { startsWith: "MLB:standings:2026:" } } }),
    )
    expect(field.seeds.get("al")?.get(1)).toBe("Tampa Bay Rays")
    expect(field.seeds.get("al")?.get(4)).toBe("New York Yankees")
    expect(field.rowsRead).toBe(6)
    expect(field.warnings).toEqual([])
  })

  /*
   * NBA/NHL seasons span two years, standings rows are never purged, and seed writes are
   * permanent — so the season is DERIVED from when the pool was made, never picked by which key
   * exists. Both existence-based orders shipped and each seeded some window from last season.
   */
  const stubStandings = () =>
    db.sportsDataCache.findMany.mockImplementation(async ({ where }: { where: { cacheKey: { startsWith: string } } }) => {
      if (where.cacheKey.startsWith === "NHL:standings:2025:")
        return [{ data: { conference: "Western Conference", position: 1, teamName: "Winnipeg Jets", won: 56, lost: 26 } }]
      if (where.cacheKey.startsWith === "NHL:standings:2026:")
        return [{ data: { conference: "Western Conference", position: 1, teamName: "Dallas Stars", won: 5, lost: 2 } }]
      return []
    })
  const readKeys = () =>
    db.sportsDataCache.findMany.mock.calls.map((c: Array<{ where: { cacheKey: { startsWith: string } } }>) => c[0].where.cacheKey.startsWith)

  it("a pool made BEFORE tip-off reads the coming season and waits — it never reaches last season's final rows", async () => {
    stubStandings()
    const { resolvePlayoffSeedField } = await import("@/lib/playoffs/playoffSeeding")
    const field = await resolvePlayoffSeedField("nhl", 2026, new Date("2026-08-15T00:00:00Z"))
    expect(readKeys()).toEqual(["NHL:standings:2026:"])
    expect(field.season).toBe("2026")
  })

  it("a pool made in November reads the season in progress", async () => {
    stubStandings()
    const { resolvePlayoffSeedField } = await import("@/lib/playoffs/playoffSeeding")
    const field = await resolvePlayoffSeedField("nhl", 2026, new Date("2026-11-10T00:00:00Z"))
    expect(readKeys()).toEqual(["NHL:standings:2026:"])
    expect(field.rowsRead).toBe(1)
  })

  it("a pool made in April 2027 for the 2027 playoffs reads 2026-27", async () => {
    stubStandings()
    const { resolvePlayoffSeedField } = await import("@/lib/playoffs/playoffSeeding")
    await resolvePlayoffSeedField("nhl", 2027, new Date("2027-04-12T00:00:00Z"))
    expect(readKeys()).toEqual(["NHL:standings:2026:"])
  })

  it("splitYearSeasonStart: both labels of a season resolve to its start year; others read as a playoff year", async () => {
    const { splitYearSeasonStart } = await import("@/lib/playoffs/playoffSeeding")
    const autumn = new Date("2026-09-01T00:00:00Z")
    const spring = new Date("2027-03-01T00:00:00Z")
    expect(splitYearSeasonStart(2026, autumn)).toBe(2026)
    expect(splitYearSeasonStart(2027, autumn)).toBe(2026)
    expect(splitYearSeasonStart(2026, spring)).toBe(2026)
    expect(splitYearSeasonStart(2027, spring)).toBe(2026)
    expect(splitYearSeasonStart(2025, autumn)).toBe(2024) // explicit historic playoff year
    expect(splitYearSeasonStart(2027, null)).toBe(2026) // no createdAt: playoff calendar year
    expect(splitYearSeasonStart(2026, new Date("2026-06-30T23:00:00Z"))).toBe(2025) // June is still last season
    expect(splitYearSeasonStart(2026, new Date("2026-07-01T00:00:00Z"))).toBe(2026)
  })

  it("says so when nothing has been ingested, rather than returning a silent empty field", async () => {
    db.sportsDataCache.findMany.mockResolvedValue([])
    const { resolvePlayoffSeedField } = await import("@/lib/playoffs/playoffSeeding")

    const field = await resolvePlayoffSeedField("mlb", 2026)

    expect(field.seeds.size).toBe(0)
    expect(field.warnings.join(" ")).toContain("MLB:standings:2026:")
  })

  it("reports a duplicate seed instead of picking one at random", async () => {
    db.sportsDataCache.findMany.mockResolvedValue([
      cacheRow("Tampa Bay Rays", "American League", 1),
      cacheRow("Imposter Club", "American League", 1),
    ])
    const { resolvePlayoffSeedField } = await import("@/lib/playoffs/playoffSeeding")

    const field = await resolvePlayoffSeedField("mlb", 2026)

    expect(field.seeds.get("al")?.get(1)).toBe("Tampa Bay Rays")
    expect(field.warnings.join(" ")).toContain("duplicate seed al1")
  })

  it("maps the conference vocabularies of both bracket shapes", async () => {
    db.sportsDataCache.findMany.mockResolvedValue([
      cacheRow("Tampa Bay Rays", "American League", 1),
      cacheRow("Milwaukee Brewers", "National League", 1),
      cacheRow("Boston Celtics", "Eastern Conference", 1),
      cacheRow("Denver Nuggets", "Western Conference", 1),
      cacheRow("Nobody FC", "Some Other Group", 1),
    ])
    const { resolvePlayoffSeedField } = await import("@/lib/playoffs/playoffSeeding")

    const field = await resolvePlayoffSeedField("mlb", 2026)

    expect([...field.seeds.keys()].sort()).toEqual(["al", "east", "nl", "west"])
  })
})

describe("applyPlayoffSeedsToChallenge", () => {
  beforeEach(() => {
    db.sportsDataCache.findMany.mockResolvedValue(AL_FIELD)
  })

  it("fills seed placeholders with real clubs", async () => {
    db.playoffBracketSeries.findMany.mockResolvedValue([series()])
    const { applyPlayoffSeedsToChallenge } = await import("@/lib/playoffs/playoffSeeding")

    const result = await applyPlayoffSeedsToChallenge({ challengeId: "c1" })

    expect(result.slotsFilled).toBe(2)
    expect(db.playoffBracketSeries.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { homeTeamName: "Tampa Bay Rays" },
    })
    expect(db.playoffBracketSeries.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { awayTeamName: "New York Yankees" },
    })
  })

  /*
   * The invariant that makes this safe to run on a pool people have already
   * entered. A pick is a string; rename the slot without it and the pick names
   * a team that is no longer in its series — not wrong, UNSCOREABLE, and
   * nothing type-checks or tests it.
   */
  it("rewrites picks that named the placeholder, in the same transaction", async () => {
    db.playoffBracketSeries.findMany.mockResolvedValue([series()])
    db.playoffBracketPick.updateMany.mockResolvedValue({ count: 3 })
    const { applyPlayoffSeedsToChallenge } = await import("@/lib/playoffs/playoffSeeding")

    const result = await applyPlayoffSeedsToChallenge({ challengeId: "c1" })

    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(result.picksMigrated).toBe(6)
    expect(db.playoffBracketPick.updateMany).toHaveBeenCalledWith({
      where: { seriesId: "s1", pickTeamName: "AL1" },
      data: { pickTeamName: "Tampa Bay Rays" },
    })
    // Scoped to the series, never the whole challenge: the same placeholder
    // string legitimately appears in more than one series.
    for (const call of db.playoffBracketPick.updateMany.mock.calls) {
      expect(call[0].where).toHaveProperty("seriesId")
    }
  })

  it("never overwrites a name that is already a real club", async () => {
    db.playoffBracketSeries.findMany.mockResolvedValue([
      series({ homeTeamName: "Tampa Bay Rays", awayTeamName: "AL4" }),
    ])
    const { applyPlayoffSeedsToChallenge } = await import("@/lib/playoffs/playoffSeeding")

    const result = await applyPlayoffSeedsToChallenge({ challengeId: "c1" })

    expect(result.slotsFilled).toBe(1)
    expect(db.playoffBracketSeries.update).toHaveBeenCalledTimes(1)
    expect(db.playoffBracketSeries.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { awayTeamName: "New York Yankees" },
    })
  })

  it("is a no-op on a second run", async () => {
    db.playoffBracketSeries.findMany.mockResolvedValue([
      series({ homeTeamName: "Tampa Bay Rays", awayTeamName: "New York Yankees" }),
    ])
    const { applyPlayoffSeedsToChallenge } = await import("@/lib/playoffs/playoffSeeding")

    const result = await applyPlayoffSeedsToChallenge({ challengeId: "c1" })

    expect(result.slotsFilled).toBe(0)
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(db.playoffBracketSeries.update).not.toHaveBeenCalled()
  })

  /*
   * The guard that decides whether seeding may happen AT ALL.
   *
   * Seeding only fills placeholders and is idempotent, so a club written from
   * a provisional field is permanent — the bracket keeps whoever held the last
   * wild card that day, and nothing downstream corrects it. Measured
   * 2026-09-19: MLB was at 153-155 of 162, AL seeds 6 and 7 two wins apart.
   */
  it("writes nothing while the regular season is still being played", async () => {
    db.sportsDataCache.findMany.mockResolvedValue(
      AL_FIELD.map((r) => cacheRow(String(r.data.teamName), "American League", Number(r.data.position), 154)),
    )
    db.playoffBracketSeries.findMany.mockResolvedValue([series()])
    const { applyPlayoffSeedsToChallenge } = await import("@/lib/playoffs/playoffSeeding")

    const result = await applyPlayoffSeedsToChallenge({ challengeId: "c1" })

    expect(result.skippedFieldNotFinal).toBe(true)
    expect(result.slotsFilled).toBe(0)
    expect(db.playoffBracketSeries.update).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(result.warnings.join(" ")).toContain("154 of 162")
  })

  it("allows the rainout case — a season short by a game or two is still over", async () => {
    db.sportsDataCache.findMany.mockResolvedValue(
      AL_FIELD.map((r) => cacheRow(String(r.data.teamName), "American League", Number(r.data.position), 160)),
    )
    db.playoffBracketSeries.findMany.mockResolvedValue([series()])
    const { applyPlayoffSeedsToChallenge } = await import("@/lib/playoffs/playoffSeeding")

    const result = await applyPlayoffSeedsToChallenge({ challengeId: "c1" })

    expect(result.skippedFieldNotFinal).toBe(false)
    expect(result.slotsFilled).toBe(2)
  })

  it("refuses a sport whose season length it does not know", async () => {
    db.playoffBracketChallenge.findUnique.mockResolvedValue({ id: "c1", sport: "cricket", seasonYear: 2026 })
    db.sportsDataCache.findMany.mockResolvedValue(AL_FIELD)
    db.playoffBracketSeries.findMany.mockResolvedValue([series()])
    const { applyPlayoffSeedsToChallenge } = await import("@/lib/playoffs/playoffSeeding")

    const result = await applyPlayoffSeedsToChallenge({ challengeId: "c1" })

    // Unknown must refuse, not default to final — the mistake is permanent.
    expect(result.skippedFieldNotFinal).toBe(true)
    expect(result.slotsFilled).toBe(0)
    expect(result.warnings.join(" ")).toContain("no regular-season length known")
  })

  /*
   * A later-round slot reads "Winner S2", not "AL3". It is not a seed and must
   * never be filled from standings — that would pencil in a team for a series
   * nobody has played.
   */
  it("leaves progression placeholders alone", async () => {
    db.playoffBracketSeries.findMany.mockResolvedValue([
      series({ id: "s9", homeSeed: 0, awaySeed: 0, homeTeamName: "Winner S5", awayTeamName: "Winner S6" }),
    ])
    const { applyPlayoffSeedsToChallenge } = await import("@/lib/playoffs/playoffSeeding")

    const result = await applyPlayoffSeedsToChallenge({ challengeId: "c1" })

    expect(result.slotsFilled).toBe(0)
    expect(db.playoffBracketSeries.update).not.toHaveBeenCalled()
  })

  it("counts a slot it cannot resolve rather than inventing a club", async () => {
    db.sportsDataCache.findMany.mockResolvedValue([cacheRow("Tampa Bay Rays", "American League", 1)])
    db.playoffBracketSeries.findMany.mockResolvedValue([series()])
    const { applyPlayoffSeedsToChallenge } = await import("@/lib/playoffs/playoffSeeding")

    const result = await applyPlayoffSeedsToChallenge({ challengeId: "c1" })

    expect(result.slotsFilled).toBe(1)
    expect(result.slotsUnresolved).toBe(1)
  })
})

describe("applyPlayoffSeedsToChallenges", () => {
  it("resolves each sport+season field once, not once per challenge", async () => {
    db.playoffBracketChallenge.findMany.mockResolvedValue([
      { id: "c1", sport: "mlb", seasonYear: 2026 },
      { id: "c2", sport: "mlb", seasonYear: 2026 },
      { id: "c3", sport: "nba", seasonYear: 2026 },
    ])
    db.playoffBracketChallenge.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id, sport: where.id === "c3" ? "nba" : "mlb", seasonYear: 2026 }),
    )
    db.sportsDataCache.findMany.mockResolvedValue(AL_FIELD)
    db.playoffBracketSeries.findMany.mockResolvedValue([])
    const { applyPlayoffSeedsToChallenges } = await import("@/lib/playoffs/playoffSeeding")

    await applyPlayoffSeedsToChallenges(["c1", "c2", "c3"])

    // Two distinct (sport, season) pairs across three challenges.
    expect(db.sportsDataCache.findMany).toHaveBeenCalledTimes(2)
  })

  it("isolates one broken challenge from the rest", async () => {
    db.playoffBracketChallenge.findMany.mockResolvedValue([
      { id: "bad", sport: "mlb", seasonYear: 2026 },
      { id: "good", sport: "mlb", seasonYear: 2026 },
    ])
    db.sportsDataCache.findMany.mockResolvedValue(AL_FIELD)
    db.playoffBracketSeries.findMany.mockImplementation(({ where }: { where: { challengeId: string } }) =>
      where.challengeId === "bad" ? Promise.reject(new Error("series read exploded")) : Promise.resolve([series()]),
    )
    db.playoffBracketChallenge.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id, sport: "mlb", seasonYear: 2026 }),
    )
    const { applyPlayoffSeedsToChallenges } = await import("@/lib/playoffs/playoffSeeding")

    const sweep = await applyPlayoffSeedsToChallenges(["bad", "good"])

    expect(sweep.errors).toHaveLength(1)
    expect(sweep.errors[0]).toContain("bad")
    expect(sweep.challengesSeeded).toBe(1)
    expect(sweep.slotsFilled).toBe(2)
  })

  it("does nothing, and reads nothing, for an empty sweep", async () => {
    const { applyPlayoffSeedsToChallenges } = await import("@/lib/playoffs/playoffSeeding")

    const sweep = await applyPlayoffSeedsToChallenges([])

    expect(sweep.slotsFilled).toBe(0)
    expect(db.playoffBracketChallenge.findMany).not.toHaveBeenCalled()
    expect(db.sportsDataCache.findMany).not.toHaveBeenCalled()
  })
})
