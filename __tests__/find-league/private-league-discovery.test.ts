// @vitest-environment node
/**
 * Where private "Ask to join" cards appear: the finder's "Public & private" view (now its default)
 * and nowhere else. Chimmy, saved-search alerts, creator pages and recommendations ask for
 * "public" and must keep seeing public leagues only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DiscoveryCard } from "@/lib/public-discovery/types"

const q = vi.hoisted(() => ({
  publicCards: vi.fn(async () => [] as DiscoveryCard[]),
  privateCards: vi.fn(async () => [] as DiscoveryCard[]),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    league: { findMany: vi.fn(async () => []) },
    bracketLeague: { findMany: vi.fn(async () => []) },
    creatorLeague: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock("@/lib/public-discovery/DiscoveryQueryLayer", () => ({
  queryPublicFantasyLeagueCards: q.publicCards,
  queryPrivateRequestableFantasyLeagueCards: q.privateCards,
  queryPublicBracketLeagueCards: vi.fn(async () => []),
  queryPublicCreatorLeagueCards: vi.fn(async () => []),
}))
vi.mock("@/lib/league-search", () => ({ searchLeagues: vi.fn(async () => ({ hits: [] })) }))
vi.mock("@/lib/class-rating/reads", () => ({ getManagerClass: vi.fn(async () => ({ status: "unrated" })) }))
vi.mock("@/lib/class-rating/divisionGate", async (orig) => ({
  ...(await orig<typeof import("@/lib/class-rating/divisionGate")>()),
  getLeagueDivisions: vi.fn(async () => new Map()),
}))

import { clearDiscoveryCache, discoverPublicLeagues } from "@/lib/public-discovery/PublicDiscoveryService"

function card(id: string, o: Partial<DiscoveryCard> = {}): DiscoveryCard {
  return {
    source: "fantasy",
    id,
    name: `League ${id}`,
    description: null,
    sport: "NFL",
    memberCount: 4,
    maxMembers: 12,
    joinUrl: "/join?code=x",
    detailUrl: `/leagues/${id}`,
    ownerName: "c",
    ownerAvatar: null,
    creatorSlug: null,
    creatorName: null,
    tournamentName: null,
    season: 2026,
    scoringMode: "ppr",
    isPaid: false,
    isPrivate: false,
    createdAt: "2026-10-01T00:00:00Z",
    fillPct: 33,
    leagueType: "fantasy",
    leagueStyle: "redraft",
    draftType: null,
    draftStatus: null,
    teamCount: 12,
    draftDate: null,
    commissionerName: "c",
    aiFeatures: [],
    leagueTier: 1,
    ...o,
  } as DiscoveryCard
}

beforeEach(() => {
  clearDiscoveryCache()
  q.publicCards.mockReset().mockResolvedValue([card("pub")])
  q.privateCards.mockReset().mockResolvedValue([card("priv", { joinMode: "approval", isPrivate: true, joinUrl: "", detailUrl: "" })])
})

describe("private cards in discovery", () => {
  it('"Public & private" lists both', async () => {
    const result = await discoverPublicLeagues({ visibility: "all" })
    expect(result.leagues.map((l) => l.id).sort()).toEqual(["priv", "pub"])
  })

  it('"Public" lists public leagues only and never reads private ones', async () => {
    const result = await discoverPublicLeagues({ visibility: "public" })
    expect(result.leagues.map((l) => l.id)).toEqual(["pub"])
    expect(q.privateCards).not.toHaveBeenCalled()
  })

  it("no visibility given (every non-finder caller) means public only", async () => {
    const result = await discoverPublicLeagues({})
    expect(result.leagues.map((l) => l.id)).toEqual(["pub"])
    expect(q.privateCards).not.toHaveBeenCalled()
  })

  it("the bracket or creator format never reads private fantasy leagues", async () => {
    await discoverPublicLeagues({ visibility: "all", format: "bracket" })
    expect(q.privateCards).not.toHaveBeenCalled()
  })
})

/*
 * Guilly has its own category (audit 2026-11-06, row "Discovery"). The filter value must survive the
 * service's style normalizer, or "Guilly" silently means "any style".
 */
describe("the Guilly filter", () => {
  it("lists public and private Guilly leagues and nothing else", async () => {
    q.publicCards.mockResolvedValue([card("pub-guilly", { leagueStyle: "guillotine" }), card("pub-redraft")])
    q.privateCards.mockResolvedValue([
      card("priv-guilly", { leagueStyle: "guillotine", joinMode: "approval", isPrivate: true, joinUrl: "", detailUrl: "" }),
    ])
    const result = await discoverPublicLeagues({ visibility: "all", style: "guillotine" })
    expect(result.leagues.map((l) => l.id).sort()).toEqual(["priv-guilly", "pub-guilly"])
  })
})
