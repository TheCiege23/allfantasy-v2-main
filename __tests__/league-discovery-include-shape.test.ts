import { describe, expect, it } from "vitest"
import { Prisma } from "@prisma/client"
import { DISCOVERY_INCLUDE } from "@/lib/league-discovery/LeagueDiscoveryService"

/**
 * Every key of a Prisma `include` must be a RELATION.
 *
 * 🛑 THIS EXACT MISTAKE 500'd A PUBLIC ENDPOINT FOR SIX MONTHS. `include` held
 * `scoringRules: true` — a `Json?` column, not a relation — so every call to
 * `/api/bracket/discover` threw "Invalid `prisma.bracketLeague.findMany()`
 * invocation" from 2026-03-17 (`be9816c52`) until it was fixed. It was
 * invisible to the compiler because the call went through `(prisma as any)`,
 * and invisible to users because /brackets/discover renders an empty state
 * rather than surfacing the error.
 *
 * ⚠ THE CHECK READS THE GENERATED CLIENT, NOT A HAND-WRITTEN LIST. `Prisma.dmmf`
 * is the same schema the query runs against, so this cannot drift from the
 * model the way a copy of the field names would.
 */

const model = Prisma.dmmf.datamodel.models.find((m) => m.name === "BracketLeague")

describe("the discovery query's include", () => {
  it("BracketLeague is in the generated client at all", () => {
    // If this fails the rest is vacuous — a missing model would make every
    // "is a relation" check pass by never running.
    expect(model, "BracketLeague not found in Prisma.dmmf").toBeTruthy()
  })

  it("joins only relations — a scalar here is a runtime 500", () => {
    const relations = new Set(model!.fields.filter((f) => f.kind === "object").map((f) => f.name))
    const scalars = new Set(model!.fields.filter((f) => f.kind !== "object").map((f) => f.name))

    // `_count` is Prisma's own aggregate key, not a model field.
    const joined = Object.keys(DISCOVERY_INCLUDE).filter((key) => key !== "_count")
    expect(joined.length).toBeGreaterThan(0)

    for (const key of joined) {
      expect(scalars.has(key), `${key} is a scalar column — it cannot be included`).toBe(false)
      expect(relations.has(key), `${key} is not a relation on BracketLeague`).toBe(true)
    }
  })

  it("does not ask for scoringRules, which include returns anyway", () => {
    // The regression, named. `include` yields every scalar by default, so the
    // filter below it (`lg.scoringRules`) never needed this key.
    expect(Object.keys(DISCOVERY_INCLUDE)).not.toContain("scoringRules")
    expect(new Set(model!.fields.filter((f) => f.kind !== "object").map((f) => f.name))).toContain(
      "scoringRules",
    )
  })

  it("still joins what the cards render", () => {
    // owner -> display name/avatar, tournament -> sport/season/name,
    // _count -> members/entries. Dropping one of these empties a card field.
    expect(Object.keys(DISCOVERY_INCLUDE).sort()).toEqual(["_count", "owner", "tournament"])
  })
})
