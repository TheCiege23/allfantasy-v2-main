import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * College Football Playoff seeding — admin-entered seeds through the REAL
 * seeding path, against an in-memory database.
 *
 * Mocks per call would let each step pass in isolation while the chain is
 * broken (the classic: a rename that never reaches the picks). So this fakes
 * the five Prisma surfaces the code touches and runs save → seed → correct
 * end to end on a pool built from the real CFP template.
 */

type Row = Record<string, any>
const mem = vi.hoisted(() => ({
  cache: new Map<string, { data: unknown; expiresAt: Date }>(),
  challenges: [] as Array<{ id: string; sport: string; seasonYear: number; createdAt: Date }>,
  series: [] as Row[],
  picks: [] as Row[],
}))

const db = vi.hoisted(() => {
  const matchIn = (value: unknown, cond: unknown) =>
    cond && typeof cond === "object" && "in" in (cond as Row) ? ((cond as Row).in as unknown[]).includes(value) : value === cond
  const fake: Row = {
    sportsDataCache: {
      findUnique: async ({ where }: Row) => {
        const hit = mem.cache.get(where.cacheKey)
        return hit ? { data: hit.data } : null
      },
      findMany: async ({ where }: Row) =>
        [...mem.cache.entries()].filter(([k]) => k.startsWith(where.cacheKey.startsWith)).map(([, v]) => ({ data: v.data })),
      upsert: async ({ where, create, update }: Row) => {
        const exists = mem.cache.has(where.cacheKey)
        const src = exists ? update : create
        mem.cache.set(where.cacheKey, { data: JSON.parse(JSON.stringify(src.data)), expiresAt: src.expiresAt })
        return {}
      },
    },
    playoffBracketChallenge: {
      findMany: async ({ where }: Row) =>
        mem.challenges.filter((c) =>
          where.id ? matchIn(c.id, where.id) : c.sport === where.sport && c.seasonYear === where.seasonYear,
        ),
      findUnique: async ({ where }: Row) => mem.challenges.find((c) => c.id === where.id) ?? null,
      count: async ({ where }: Row) => mem.challenges.filter((c) => c.sport === where.sport && c.seasonYear === where.seasonYear).length,
    },
    playoffBracketSeries: {
      findMany: async ({ where }: Row) => mem.series.filter((s) => matchIn(s.challengeId, where.challengeId)).map((s) => ({ ...s })),
      update: async ({ where, data }: Row) => {
        const row = mem.series.find((s) => s.id === where.id)
        Object.assign(row!, data)
        return row
      },
      count: async ({ where }: Row) =>
        mem.series.filter((s) => matchIn(s.challengeId, where.challengeId) && matchIn(s.status, where.status)).length,
    },
    playoffBracketPick: {
      updateMany: async ({ where, data }: Row) => {
        let count = 0
        for (const p of mem.picks) {
          if (matchIn(p.seriesId, where.seriesId) && p.pickTeamName === where.pickTeamName) {
            Object.assign(p, data)
            count += 1
          }
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

import { buildPlayoffTemplate } from "@/lib/playoffs/playoffTemplate"
import {
  cfpSeedCorrections,
  cfpSeedMapByHalf,
  cfpSeedsCacheKey,
  readCfpSeeds,
  validateCfpSeeds,
} from "@/lib/playoffs/cfpSeeds"
import { saveCfpSeedsAndApply } from "@/lib/playoffs/cfpSeedAdmin"
import { resolvePlayoffSeedField } from "@/lib/playoffs/playoffSeeding"

/** The real 2024-25 field, in seed order. */
const FIELD_2024 = [
  "Oregon", "Georgia", "Boise State", "Arizona State", "Texas", "Penn State",
  "Notre Dame", "Ohio State", "Tennessee", "Indiana", "SMU", "Clemson",
]

/** A CFP pool built from the real template, plus a few picks made BEFORE seeding. */
function seedPool(id: string, season = 2026) {
  mem.challenges.push({ id, sport: "ncaaf", seasonYear: season, createdAt: new Date("2026-11-20T00:00:00Z") })
  for (const row of buildPlayoffTemplate({ sport: "ncaaf", seasonYear: season })) {
    mem.series.push({ ...row, id: `${id}-s${row.seriesNumber}`, challengeId: id })
  }
  mem.picks.push(
    { id: `${id}-p1`, seriesId: `${id}-s1`, pickTeamName: "CFP8" }, // 8 v 9
    { id: `${id}-p2`, seriesId: `${id}-s5`, pickTeamName: "CFP8" }, // carried into #1's quarterfinal
    { id: `${id}-p3`, seriesId: `${id}-s2`, pickTeamName: "CFP5" }, // 5 v 12
  )
}
const slot = (id: string, n: number) => mem.series.find((s) => s.id === `${id}-s${n}`)!
const pick = (id: string, p: string) => mem.picks.find((x) => x.id === `${id}-${p}`)!

beforeEach(() => {
  mem.cache.clear()
  mem.challenges.length = 0
  mem.series.length = 0
  mem.picks.length = 0
})

describe("validateCfpSeeds", () => {
  it("accepts twelve distinct team names, trimming whitespace", () => {
    const result = validateCfpSeeds(FIELD_2024.map((n) => `  ${n} `))
    expect(result).toEqual({ ok: true, seeds: FIELD_2024 })
  })

  it("refuses the wrong count, blanks, duplicates and placeholder-looking names", () => {
    expect(validateCfpSeeds(FIELD_2024.slice(0, 11)).ok).toBe(false)
    const blanks = [...FIELD_2024]
    blanks[4] = "  "
    expect(validateCfpSeeds(blanks)).toMatchObject({ ok: false, errors: ["Seed 5 is empty."] })
    const dup = [...FIELD_2024]
    dup[11] = "texas"
    expect(validateCfpSeeds(dup)).toMatchObject({ ok: false, errors: ['Seed 12 repeats seed 5 ("texas").'] })
    for (const bad of ["CFP3", "Winner S2", "SEC Champion"]) {
      const list = [...FIELD_2024]
      list[0] = bad
      expect(validateCfpSeeds(list).ok, bad).toBe(false)
    }
    expect(validateCfpSeeds("Oregon, Georgia").ok).toBe(false)
  })

  it("offers the one national seed map under both bracket halves", () => {
    const byHalf = cfpSeedMapByHalf(FIELD_2024)
    expect(byHalf.get("upper")!.get(1)).toBe("Oregon")
    expect(byHalf.get("lower")!.get(12)).toBe("Clemson")
  })

  it("reports only the seeds whose name changed", () => {
    const fixed = [...FIELD_2024]
    fixed[7] = "Ohio State Buckeyes"
    expect(cfpSeedCorrections(FIELD_2024, fixed)).toEqual([{ seed: 8, from: "Ohio State", to: "Ohio State Buckeyes" }])
    expect(cfpSeedCorrections(null, FIELD_2024)).toEqual([])
  })
})

describe("resolvePlayoffSeedField for ncaaf", () => {
  it("is NOT final until seeds are saved — nothing may be written from an empty field", async () => {
    const field = await resolvePlayoffSeedField("ncaaf", 2026)
    expect(field.isFinal).toBe(false)
    expect(field.warnings.join(" ")).toContain("/admin/cfp-seeding")
  })
})

describe("saveCfpSeedsAndApply — end to end", () => {
  it("fills every placeholder in every pool and moves the picks that named them", async () => {
    seedPool("c1")
    seedPool("c2")
    const result = await saveCfpSeedsAndApply({ season: 2026, seeds: FIELD_2024, userId: "admin-1" })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.pools).toBe(2)
    // 8 first-round slots + 4 bye seeds per pool.
    expect(result.sweep.slotsFilled).toBe(24)
    expect(result.sweep.slotsUnresolved).toBe(0)
    for (const id of ["c1", "c2"]) {
      expect([slot(id, 1).homeTeamName, slot(id, 1).awayTeamName]).toEqual(["Ohio State", "Tennessee"])
      expect(slot(id, 5).homeTeamName).toBe("Oregon")
      expect(slot(id, 5).awayTeamName).toBe("Winner S1") // a feeder placeholder is never touched
      expect(slot(id, 11).homeTeamName).toBe("Winner S9")
      expect(pick(id, "p1").pickTeamName).toBe("Ohio State")
      expect(pick(id, "p3").pickTeamName).toBe("Texas")
    }
    expect(await readCfpSeeds(2026)).toMatchObject({ season: 2026, seeds: FIELD_2024, enteredByUserId: "admin-1" })
  })

  it("is idempotent: saving the same seeds again changes nothing", async () => {
    seedPool("c1")
    await saveCfpSeedsAndApply({ season: 2026, seeds: FIELD_2024, userId: "a" })
    const again = await saveCfpSeedsAndApply({ season: 2026, seeds: FIELD_2024, userId: "a" })
    expect(again.ok && again.sweep.slotsFilled).toBe(0)
    expect(again.ok && again.corrections).toEqual([])
  })

  it("corrects a typo everywhere it was written — slots AND picks", async () => {
    seedPool("c1")
    const typo = [...FIELD_2024]
    typo[7] = "Ohio Sate"
    await saveCfpSeedsAndApply({ season: 2026, seeds: typo, userId: "a" })
    expect(pick("c1", "p1").pickTeamName).toBe("Ohio Sate")

    const fixed = await saveCfpSeedsAndApply({ season: 2026, seeds: FIELD_2024, userId: "a" })
    expect(fixed.ok && fixed.corrections).toEqual([{ seed: 8, from: "Ohio Sate", to: "Ohio State" }])
    expect(slot("c1", 1).homeTeamName).toBe("Ohio State")
    // Both picks that named the typo follow it — including the one carried into the quarterfinal.
    expect(pick("c1", "p1").pickTeamName).toBe("Ohio State")
    expect(pick("c1", "p2").pickTeamName).toBe("Ohio State")
  })

  it("handles a SWAP (two seeds entered the wrong way round) without collapsing them", async () => {
    seedPool("c1")
    const swapped = [...FIELD_2024]
    ;[swapped[4], swapped[5]] = [swapped[5], swapped[4]] // Penn State at #5, Texas at #6
    await saveCfpSeedsAndApply({ season: 2026, seeds: swapped, userId: "a" })
    expect(slot("c1", 2).homeTeamName).toBe("Penn State")
    expect(slot("c1", 4).homeTeamName).toBe("Texas")

    const fixed = await saveCfpSeedsAndApply({ season: 2026, seeds: FIELD_2024, userId: "a" })
    expect(fixed.ok).toBe(true)
    // #5 is Texas again and #6 Penn State — not two of either.
    expect(slot("c1", 2).homeTeamName).toBe("Texas")
    expect(slot("c1", 4).homeTeamName).toBe("Penn State")
    // The pick made in seed 5's slot follows the slot.
    expect(pick("c1", "p3").pickTeamName).toBe("Texas")
  })

  it("refuses a correction once any game has started, and writes nothing", async () => {
    seedPool("c1")
    await saveCfpSeedsAndApply({ season: 2026, seeds: FIELD_2024, userId: "a" })
    slot("c1", 1).status = "final"

    const changed = [...FIELD_2024]
    changed[7] = "Ohio State Buckeyes"
    const result = await saveCfpSeedsAndApply({ season: 2026, seeds: changed, userId: "a" })
    expect(result.ok).toBe(false)
    expect((await readCfpSeeds(2026))!.seeds).toEqual(FIELD_2024)
    expect(slot("c1", 1).homeTeamName).toBe("Ohio State")
  })

  it("refuses an invalid list before reading or writing anything", async () => {
    seedPool("c1")
    const result = await saveCfpSeedsAndApply({ season: 2026, seeds: FIELD_2024.slice(0, 10), userId: "a" })
    expect(result.ok).toBe(false)
    expect(mem.cache.has(cfpSeedsCacheKey(2026))).toBe(false)
    expect(slot("c1", 1).homeTeamName).toBe("CFP8")
  })

  it("only touches the season it was given", async () => {
    seedPool("c1", 2026)
    seedPool("old", 2025)
    await saveCfpSeedsAndApply({ season: 2026, seeds: FIELD_2024, userId: "a" })
    expect(slot("old", 1).homeTeamName).toBe("CFP8")
  })
})

/*
 * The invariant applyPlayoffSeedsToChallenge's CHALLENGE-WIDE pick rename rests
 * on. Picks are renamed across every series of a pool, which is only safe if a
 * placeholder like `CFP8` or `AL4` names one seed in one place. If a template
 * ever seated the same placeholder in two series, a rename would move picks the
 * admin never meant to touch — so this pins it for every sport, not just CFP.
 */
describe("seed placeholders", () => {
  const SEED_PLACEHOLDER = /^(AL|NL|EAST|WEST|CFP)\d+$/i
  for (const sport of ["nba", "nhl", "mlb", "ncaaf"] as const) {
    it(`each appears in exactly one series of the ${sport} template`, () => {
      const seen = new Map<string, number>()
      let placeholders = 0
      for (const row of buildPlayoffTemplate({ sport, seasonYear: 2026 })) {
        for (const name of [row.homeTeamName, row.awayTeamName]) {
          if (!name || !SEED_PLACEHOLDER.test(name)) continue
          placeholders += 1
          const key = name.toUpperCase()
          expect(seen.get(key), `${key} in S${seen.get(key)} and S${row.seriesNumber}`).toBeUndefined()
          seen.set(key, row.seriesNumber)
        }
      }
      // Guard against a vacuous pass: a template with no placeholders would
      // satisfy the loop above while testing nothing.
      expect(placeholders).toBeGreaterThan(0)
    })
  }
})
