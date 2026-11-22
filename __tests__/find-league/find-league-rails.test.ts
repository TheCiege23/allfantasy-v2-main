/**
 * "Picked for you" on /find-league asked /api/find-league/recommendations, which never existed:
 * every visit spent a request on a 404 and the section rendered nothing. These pin the rows that
 * replace it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DiscoveryCard } from "@/lib/public-discovery/types"
import { buildFindLeagueRails, FIND_LEAGUE_RAIL_CAP } from "@/lib/public-discovery/findLeagueRails"

const NOW = Date.parse("2026-11-01T12:00:00Z")

function card(id: string, o: Partial<DiscoveryCard> = {}): DiscoveryCard {
  return {
    source: "fantasy",
    id,
    name: id,
    description: null,
    sport: "NFL",
    memberCount: 2,
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
    fillPct: 17,
    leagueType: "fantasy",
    leagueStyle: "redraft",
    draftType: "snake",
    draftStatus: "pre_draft",
    teamCount: 12,
    draftDate: null,
    commissionerName: "c",
    aiFeatures: [],
    ...o,
  }
}

describe("buildFindLeagueRails", () => {
  it("files each league under the first row it fits, so no league repeats", () => {
    const rails = buildFindLeagueRails(
      [
        card("a", { rankBand: "your_level", fillPct: 80, memberCount: 10 }),
        card("b", { rankBand: "step_up" }),
        card("c", { draftDate: "2026-11-04T00:00:00Z" }),
        card("d", { fillPct: 60, memberCount: 8 }),
      ],
      NOW
    )
    expect(rails.map((r) => [r.kind, r.leagues.map((l) => l.id)])).toEqual([
      ["your_level", ["a"]],
      ["step_up", ["b"]],
      ["drafting_soon", ["c"]],
      ["filling_fast", ["d"]],
    ])
  })

  it("never recommends a full league, a past draft or one more than a week out", () => {
    const rails = buildFindLeagueRails(
      [
        card("full", { rankBand: "your_level", memberCount: 12, fillPct: 100 }),
        card("past", { draftDate: "2026-10-30T00:00:00Z" }),
        card("far", { draftDate: "2026-11-20T00:00:00Z" }),
      ],
      NOW
    )
    expect(rails).toEqual([])
  })

  it("caps a row and keeps the order it was given", () => {
    const many = Array.from({ length: 9 }, (_, i) => card(`l${i}`, { rankBand: "your_level" }))
    const [row] = buildFindLeagueRails(many, NOW)
    expect(row.leagues.map((l) => l.id)).toEqual(many.slice(0, FIND_LEAGUE_RAIL_CAP).map((l) => l.id))
  })
})

const discover = vi.hoisted(() => vi.fn())
const session = vi.hoisted(() => ({ value: null as null | { user: { id: string } } }))
vi.mock("@/lib/public-discovery", () => ({ discoverPublicLeagues: discover }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => session.value) }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/ranking/tier-visibility", () => ({ resolveUserCareerTier: vi.fn(async () => 3) }))
vi.mock("@/lib/http/served-origin", () => ({ getServedOrigin: () => "https://allfantasy.ai" }))

import { GET } from "@/app/api/find-league/recommendations/route"

function req(qs = "") {
  return { nextUrl: new URL(`https://allfantasy.ai/api/find-league/recommendations${qs}`) } as never
}

describe("GET /api/find-league/recommendations", () => {
  beforeEach(() => {
    discover.mockReset()
    session.value = null
  })

  it("exists, and reads the rank-fit discovery list for the viewer", async () => {
    session.value = { user: { id: "u1" } }
    discover.mockResolvedValue({ leagues: [card("a", { rankBand: "your_level" })] })
    const res = await GET(req("?sport=NFL"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ok")
    expect(body.rails[0].kind).toBe("your_level")
    const [input, , viewer] = discover.mock.calls[0]
    expect(input).toMatchObject({ sport: "NFL", sort: "ranking_match", visibility: "public" })
    expect(viewer).toMatchObject({ viewerUserId: "u1", viewerTier: 3 })
    expect(res.headers.get("Cache-Control")).toContain("private")
  })

  it("still gives a signed-out visitor rows, and says why there is no rank row", async () => {
    discover.mockResolvedValue({ leagues: [card("d", { fillPct: 75, memberCount: 9 })] })
    const body = await (await GET(req())).json()
    expect(body.status).toBe("anonymous")
    expect(body.rails.map((r: { kind: string }) => r.kind)).toEqual(["filling_fast"])
  })

  it("reports empty rather than an error when nothing has a seat", async () => {
    discover.mockResolvedValue({ leagues: [] })
    const body = await (await GET(req())).json()
    expect(body).toEqual({ status: "empty", rails: [] })
  })
})
