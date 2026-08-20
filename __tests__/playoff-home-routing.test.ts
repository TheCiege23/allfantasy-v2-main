import { describe, expect, it } from "vitest"
import * as routing from "@/lib/playoffs/playoffHomeRouting"

describe("playoff home card routing", () => {
  it("exports resolvePlayoffCardHref as a function", () => {
    expect(typeof routing.resolvePlayoffCardHref).toBe("function")
  })

  it("routes existing NBA challenge card to canonical league dashboard route", () => {
    const href = routing.resolvePlayoffCardHref({
      sport: "NBA",
      playoffBySport: new Map([
        [
          "nba",
          {
            challengeId: "challenge-nba",
            sport: "nba",
          },
        ],
      ]),
    })

    expect(href).toBe("/brackets/leagues/challenge-nba")
    expect(
      routing.resolvePlayoffCardMode({
        sport: "NBA",
        playoffBySport: new Map([["nba", { challengeId: "challenge-nba", sport: "nba" }]]),
      })
    ).toBe("open")
  })

  it("falls back to /brackets/nba when no NBA challenge exists", () => {
    const href = routing.resolvePlayoffCardHref({
      sport: "NBA",
      playoffBySport: new Map(),
    })

    expect(href).toBe("/brackets/nba")
    expect(routing.resolvePlayoffCardMode({ sport: "NBA", playoffBySport: new Map() })).toBe("create")
  })

  it("falls back to /brackets/nhl when no NHL challenge exists", () => {
    const href = routing.resolvePlayoffCardHref({
      sport: "NHL",
      playoffBySport: new Map(),
    })

    expect(href).toBe("/brackets/nhl")
    expect(routing.resolvePlayoffCardMode({ sport: "NHL", playoffBySport: new Map() })).toBe("create")
  })

  it("resolves My Pools NBA card href to canonical pool id route", () => {
    const href = routing.resolveMyPoolCardHref({
      poolId: "league-nba",
      sport: "NBA",
      challengeType: "playoff_challenge",
      bracketType: null,
      playoffBySport: new Map([["nba", { challengeId: "challenge-nba-1", sport: "nba" }]]),
    })

    expect(href).toBe("/brackets/leagues/league-nba")
  })

  it("resolves My Pools NHL card href to canonical pool id route", () => {
    const href = routing.resolveMyPoolCardHref({
      poolId: "league-nhl",
      sport: "NHL",
      challengeType: "playoff_challenge",
      bracketType: null,
      playoffBySport: new Map([["nhl", { challengeId: "challenge-nhl-1", sport: "nhl" }]]),
    })

    expect(href).toBe("/brackets/leagues/league-nhl")
  })

  it("keeps legacy Soccer pool cards on the legacy recovery route", () => {
    const href = routing.resolveMyPoolCardHref({
      poolId: "cd580d45-f664-42fc-9871-657e7e737703",
      sport: "SOCCER",
      challengeType: "playoff_challenge",
      bracketType: null,
      playoffBySport: new Map(),
    })

    expect(href).toBe("/brackets/leagues/cd580d45-f664-42fc-9871-657e7e737703")
    expect(href).not.toContain("/brackets/world-cup/")
  })

  it("uses provided pool id for legacy NBA league instead of playoff challenge id", () => {
    const href = routing.resolveMyPoolCardHref({
      poolId: "legacy-nba-league-id",
      sport: "NBA",
      challengeType: null,
      bracketType: null,
      playoffBySport: new Map([["nba", { challengeId: "playoff-challenge-nba", sport: "nba" }]]),
    })

    expect(href).toBe("/brackets/leagues/legacy-nba-league-id")
    expect(href).not.toBe("/brackets/leagues/playoff-challenge-nba")
  })

  it("returns /brackets for malformed input and never throws", () => {
    expect(routing.resolvePlayoffCardHref({ sport: "", playoffBySport: new Map() } as any)).toBe("/brackets")
    expect(routing.resolveMyPoolCardHref({} as any)).toBe("/brackets")
  })
})
