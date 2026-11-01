import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * NFL seeding from the standings cache, end to end against an in-memory database.
 * Same fake as playoff-cfp-seeding.test.ts, reduced to what seeding touches.
 */
type Row = Record<string, any>
const mem = vi.hoisted(() => ({
  cache: new Map<string, { data: unknown }>(),
  challenges: [] as Array<{ id: string; sport: string; seasonYear: number; createdAt: Date }>,
  series: [] as Row[],
  picks: [] as Row[],
}))

const db = vi.hoisted(() => {
  const matchIn = (value: unknown, cond: unknown) =>
    cond && typeof cond === "object" && "in" in (cond as Row) ? ((cond as Row).in as unknown[]).includes(value) : value === cond
  const fake: Row = {
    sportsDataCache: {
      findMany: async ({ where }: Row) =>
        [...mem.cache.entries()].filter(([k]) => k.startsWith(where.cacheKey.startsWith)).map(([, v]) => ({ data: v.data })),
    },
    playoffBracketChallenge: {
      findMany: async ({ where }: Row) => mem.challenges.filter((c) => matchIn(c.id, where.id)),
      findUnique: async ({ where }: Row) => mem.challenges.find((c) => c.id === where.id) ?? null,
    },
    playoffBracketSeries: {
      findMany: async ({ where }: Row) => mem.series.filter((s) => matchIn(s.challengeId, where.challengeId)).map((s) => ({ ...s })),
      update: async ({ where, data }: Row) => Object.assign(mem.series.find((s) => s.id === where.id)!, data),
    },
    playoffBracketPick: {
      updateMany: async ({ where, data }: Row) => {
        let count = 0
        for (const p of mem.picks) {
          if (matchIn(p.seriesId, where.seriesId) && p.pickTeamName === where.pickTeamName) { Object.assign(p, data); count += 1 }
        }
        return { count }
      },
    },
  }
  fake.$transaction = async (fn: (tx: unknown) => unknown) => fn(fake)
  return fake
})

vi.mock("server-only", () => ({}))
vi.mock("@/lib/prisma", () => ({ prisma: db }))

import { applyPlayoffSeedsToChallenge, resolvePlayoffSeedField } from "@/lib/playoffs/playoffSeeding"
import { buildPlayoffTemplate } from "@/lib/playoffs/playoffTemplate"

const AFC = ["Denver Broncos", "New England Patriots", "Jacksonville Jaguars", "Pittsburgh Steelers", "Houston Texans", "Buffalo Bills", "Los Angeles Chargers", "Indianapolis Colts"]
const NFC = ["Seattle Seahawks", "Chicago Bears", "Philadelphia Eagles", "Carolina Panthers", "Los Angeles Rams", "San Francisco 49ers", "Green Bay Packers", "Detroit Lions"]

function standings(opts: { games?: number; group?: (conf: "afc" | "nfc") => string; drop?: string } = {}) {
  mem.cache.clear()
  const games = opts.games ?? 17
  ;([["afc", AFC], ["nfc", NFC]] as const).forEach(([conf, teams]) => {
    teams.forEach((teamName, i) => {
      if (teamName === opts.drop) return
      const won = 15 - i
      mem.cache.set(`NFL:standings:2026:${conf}${i}`, {
        data: { teamName, position: i + 1, conference: opts.group ? opts.group(conf) : conf === "afc" ? "American Football Conference" : "National Football Conference", won, lost: games - won, tied: 0 },
      })
    })
  })
}

beforeEach(() => {
  mem.challenges.length = 0
  mem.series.length = 0
  mem.picks.length = 0
})

describe("NFL seed field from standings", () => {
  it("reads seeds 1-7 per conference and drops the eighth (a non-playoff seed or a rank)", async () => {
    standings()
    const field = await resolvePlayoffSeedField("nfl", 2026)
    expect(field.isFinal).toBe(true)
    expect([...field.seeds.get("afc")!.entries()]).toEqual(AFC.slice(0, 7).map((t, i) => [i + 1, t]))
    expect(field.seeds.get("nfc")!.get(7)).toBe("Green Bay Packers")
    expect(field.seeds.get("nfc")!.has(8)).toBe(false)
  })

  it("maps division-level group names too ('AFC East')", async () => {
    standings({ group: (conf) => (conf === "afc" ? "AFC North" : "NFC West") })
    const field = await resolvePlayoffSeedField("nfl", 2026)
    expect(field.isFinal).toBe(true)
    expect(field.seeds.get("nfc")!.get(1)).toBe("Seattle Seahawks")
  })

  it("is NOT final with a week left — no two-game tolerance for a 17-game season", async () => {
    standings({ games: 16 })
    const field = await resolvePlayoffSeedField("nfl", 2026)
    expect(field.isFinal).toBe(false)
    expect(field.warnings.join(" ")).toMatch(/16 of 17/)
  })

  it("refuses a conference that does not have exactly seeds 1-7", async () => {
    standings({ drop: "Los Angeles Chargers" })
    const field = await resolvePlayoffSeedField("nfl", 2026)
    expect(field.isFinal).toBe(false)
    expect(field.warnings.join(" ")).toMatch(/AFC field incomplete/)
  })
})

describe("seeding an NFL pool", () => {
  it("fills every AFC/NFC slot, the 1 seeds' divisional slots included, and moves picks that named a slot", async () => {
    standings()
    mem.challenges.push({ id: "pool", sport: "nfl", seasonYear: 2026, createdAt: new Date("2026-11-01T00:00:00Z") })
    for (const row of buildPlayoffTemplate({ sport: "nfl", seasonYear: 2026 })) {
      mem.series.push({ ...row, id: `s${row.seriesNumber}`, challengeId: "pool" })
    }
    mem.picks.push({ id: "p1", seriesId: "s1", pickTeamName: "AFC7" })

    const result = await applyPlayoffSeedsToChallenge({ challengeId: "pool" })
    expect(result.skippedFieldNotFinal).toBe(false)
    // 12 Wild Card slots + the two 1 seeds.
    expect(result.slotsFilled).toBe(14)
    expect(mem.series.find((s) => s.seriesNumber === 1)).toMatchObject({ homeTeamName: "New England Patriots", awayTeamName: "Los Angeles Chargers" })
    expect(mem.series.find((s) => s.seriesNumber === 9)?.homeTeamName).toBe("Seattle Seahawks")
    // Reseeded placeholders are not seed slots and stay as they are.
    expect(mem.series.find((s) => s.seriesNumber === 8)?.homeTeamName).toBe("AFC Wild Card Winner")
    expect(mem.picks[0].pickTeamName).toBe("Los Angeles Chargers")
  })

  it("writes nothing while the field is not final", async () => {
    standings({ games: 16 })
    mem.challenges.push({ id: "pool", sport: "nfl", seasonYear: 2026, createdAt: new Date() })
    for (const row of buildPlayoffTemplate({ sport: "nfl", seasonYear: 2026 })) mem.series.push({ ...row, id: `s${row.seriesNumber}`, challengeId: "pool" })
    const result = await applyPlayoffSeedsToChallenge({ challengeId: "pool" })
    expect(result.skippedFieldNotFinal).toBe(true)
    expect(mem.series.find((s) => s.seriesNumber === 1)?.homeTeamName).toBe("AFC2")
  })
})
