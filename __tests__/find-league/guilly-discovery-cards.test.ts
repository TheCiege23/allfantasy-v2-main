// @vitest-environment node
/**
 * Guilly (guillotine) in Find a League — audit 2026-11-06, row "Discovery": "No Guilly category".
 * A guillotine league read as redraft, so nobody could look for one. The card's style is now
 * `guillotine` for public AND private listed leagues; any other style it has (best ball) stays in
 * `alsoStyles`. The private card still reads and carries safe fields only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(async () => []),
  league: { findMany: vi.fn(), groupBy: vi.fn(async () => []) },
  roster: { findMany: vi.fn(async () => []) },
  appUser: { findMany: vi.fn(async () => []) },
}))
const seats = vi.hoisted(() => ({ byLeague: new Map<string, number>() }))

vi.mock("@/lib/prisma", () => ({ prisma: db }))
vi.mock("@/lib/league/leagueSeats", () => ({
  countSeatsHeldByPeople: vi.fn(async () => 1),
  countSeatsHeldByPeopleByLeague: vi.fn(async () => seats.byLeague),
}))
vi.mock("@/lib/draft-room/currentDraftSession", () => ({ CURRENT_DRAFT_SESSION_ORDER: [] }))

import {
  queryPrivateRequestableFantasyLeagueCards,
  queryPublicFantasyLeagueCards,
} from "@/lib/public-discovery/DiscoveryQueryLayer"
import { matchesDiscoveryLeagueStyle } from "@/lib/public-discovery/PublicDiscoveryService"
import { parseLeagueSearch } from "@/lib/public-discovery/findLeagueFilters"

const SECRET_CODE = "SECRET-JOIN-CODE-123"

function publicRow(o: Record<string, unknown> = {}) {
  return {
    id: "pub",
    userId: "commish",
    platform: "manual",
    isCommissioner: true,
    name: "Chop Shop",
    sport: "NFL",
    season: 2026,
    leagueVariant: null,
    leagueSize: 12,
    scoring: "ppr",
    isDynasty: false,
    guillotineMode: false,
    settings: { league_privacy_visibility: "public", inviteCode: "abc" },
    timezone: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    leagueSettings: null,
    draftSessions: [],
    user: { username: "commish", displayName: "Commish", avatarUrl: null, createdAt: new Date("2025-01-01") },
    ...o,
  }
}

function privateRow(o: Record<string, unknown> = {}) {
  return {
    id: "priv",
    platform: "manual",
    name: "Friends Chop",
    sport: "NFL",
    season: 2026,
    leagueVariant: null,
    leagueSize: 12,
    scoring: "ppr",
    isDynasty: false,
    guillotineMode: false,
    settings: { league_privacy_visibility: "private", inviteCode: SECRET_CODE, description: "discord.gg/secret" },
    createdAt: new Date("2026-10-01T00:00:00Z"),
    leagueSettings: null,
    draftSessions: [],
    ...o,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  seats.byLeague = new Map([["pub", 3], ["priv", 3]])
})

describe("a public Guilly league", () => {
  it("is listed as Guilly", async () => {
    db.league.findMany.mockResolvedValue([publicRow({ guillotineMode: true })])
    const [card] = await queryPublicFantasyLeagueCards({ sport: null, query: null })
    expect(card.leagueStyle).toBe("guillotine")
    expect(card.alsoStyles).toEqual([])
    expect(db.league.findMany.mock.calls[0][0].select).toHaveProperty("guillotineMode", true)
  })

  it("a Guilly best ball league is Guilly and still answers the best ball filter", async () => {
    db.league.findMany.mockResolvedValue([
      publicRow({ guillotineMode: true, settings: { league_privacy_visibility: "public", inviteCode: "abc", best_ball: true } }),
    ])
    const [card] = await queryPublicFantasyLeagueCards({ sport: null, query: null })
    expect(card.leagueStyle).toBe("guillotine")
    expect(card.alsoStyles).toEqual(["best_ball"])
    expect(matchesDiscoveryLeagueStyle(card, "guillotine")).toBe(true)
    expect(matchesDiscoveryLeagueStyle(card, "best_ball")).toBe(true)
    expect(matchesDiscoveryLeagueStyle(card, "redraft")).toBe(false)
  })

  it("a guillotine variant without the flag is Guilly too", async () => {
    db.league.findMany.mockResolvedValue([publicRow({ leagueVariant: "guillotine" })])
    const [card] = await queryPublicFantasyLeagueCards({ sport: null, query: null })
    expect(card.leagueStyle).toBe("guillotine")
  })

  it("[control] a plain league is still redraft and not Guilly", async () => {
    db.league.findMany.mockResolvedValue([publicRow()])
    const [card] = await queryPublicFantasyLeagueCards({ sport: null, query: null })
    expect(card.leagueStyle).toBe("redraft")
    expect(matchesDiscoveryLeagueStyle(card, "guillotine")).toBe(false)
  })
})

describe("a private listed Guilly league", () => {
  it("is listed as Guilly, with safe fields only", async () => {
    db.league.findMany.mockResolvedValue([privateRow({ guillotineMode: true })])
    const [card] = await queryPrivateRequestableFantasyLeagueCards({ sport: null, query: null })
    expect(card).toMatchObject({ id: "priv", leagueStyle: "guillotine", joinMode: "approval", isPrivate: true, joinUrl: "", detailUrl: "" })
    const json = JSON.stringify(card)
    expect(json).not.toContain(SECRET_CODE)
    expect(json).not.toContain("discord.gg")
    const select = db.league.findMany.mock.calls[0][0].select as Record<string, unknown>
    expect(select).toHaveProperty("guillotineMode", true)
    for (const key of ["user", "userId", "rosters", "teams"]) expect(select).not.toHaveProperty(key)
  })
})

describe("the search box", () => {
  it.each(["guilly nfl", "nfl guillotine"])('"%s" asks for Guilly leagues', (text) => {
    expect(parseLeagueSearch(text).style).toBe("guillotine")
  })
})
