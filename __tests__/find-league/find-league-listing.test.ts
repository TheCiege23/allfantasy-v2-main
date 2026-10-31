/**
 * Why Find a League listed nothing (measured 2026-10-30), one case per cause:
 *   - discovery read the 300 most recently updated leagues of ANY kind and filtered for public ones
 *     afterwards; imported leagues re-sync constantly and filled all 300, so the public native
 *     league was never read — the public test has to be in the query;
 *   - it counted rosters as members, and a native league has one roster per seat from creation,
 *     so every native league read as Full;
 *   - "Remove from league finder" only deactivated a row discovery never reads, so it unlisted
 *     nothing, and the route's `listed` flag disagreed with what discovery showed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  league: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  roster: { findMany: vi.fn() },
  appUser: { findMany: vi.fn() },
  findLeagueListing: { findFirst: vi.fn(), updateMany: vi.fn() },
}))

vi.mock("@/lib/prisma", () => ({ prisma: db }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => ({ user: { id: "commish" } })) }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/league/permissions", () => ({ requireCommissionerRole: vi.fn(async () => undefined) }))

import { queryPublicFantasyLeagueCards } from "@/lib/public-discovery/DiscoveryQueryLayer"
import { DELETE, GET } from "@/app/api/commissioner/leagues/[leagueId]/league-finder/route"

const ctx = { params: Promise.resolve({ leagueId: "L" }) }

function nativeLeagueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "L",
    userId: "commish",
    name: "Gridiron Gang",
    sport: "NFL",
    season: 2026,
    leagueVariant: null,
    leagueSize: 12,
    scoring: "ppr",
    isDynasty: false,
    settings: { league_privacy_visibility: "public", inviteCode: "abc" },
    timezone: "America/New_York",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    leagueSettings: null,
    draftSessions: [],
    user: { username: "commish", displayName: "Commish", avatarUrl: null },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("queryPublicFantasyLeagueCards", () => {
  it("asks the database for public leagues, rather than filtering whatever was updated last", async () => {
    db.league.findMany.mockResolvedValue([])
    db.roster.findMany.mockResolvedValue([])
    await queryPublicFantasyLeagueCards({ sport: null, query: null })
    const where = db.league.findMany.mock.calls[0][0].where
    expect(where.OR).toEqual([
      { settings: { path: ["league_privacy_visibility"], equals: "public" } },
      { settings: { path: ["publicDashboard"], equals: true } },
      { settings: { path: ["findLeagueExternal", "listed"], equals: true } },
    ])
  })

  it("counts seats held by people, so a native league with open seats is not Full", async () => {
    db.league.findMany.mockResolvedValue([nativeLeagueRow()])
    // 12 rosters exist from creation; only the commissioner's is a person.
    db.roster.findMany.mockResolvedValue([
      { leagueId: "L", platformUserId: "commish" },
      ...Array.from({ length: 11 }, (_, i) => ({ leagueId: "L", platformUserId: `open-slot-L-${i + 2}` })),
    ])
    db.appUser.findMany.mockResolvedValue([{ id: "commish" }])

    const [card] = await queryPublicFantasyLeagueCards({ sport: null, query: null })
    expect(card.memberCount).toBe(1)
    expect(card.maxMembers).toBe(12)
  })
})

describe("league-finder route", () => {
  it("reports listed from the league's settings, which is what discovery reads", async () => {
    db.findLeagueListing.findFirst.mockResolvedValue(null) // no listing row at all
    db.league.findFirst.mockResolvedValue({
      settings: { league_privacy_visibility: "public", inviteCode: "abc" },
      leagueSize: 10,
    })
    db.roster.findMany.mockResolvedValue([
      { leagueId: "L", platformUserId: "commish" },
      { leagueId: "L", platformUserId: "amy" },
      { leagueId: "L", platformUserId: "open-slot-L-3" },
    ])
    db.appUser.findMany.mockResolvedValue([{ id: "commish" }, { id: "amy" }])

    const body = await (await GET({} as never, ctx)).json()
    expect(body.listed).toBe(true)
    expect(body.listingRowActive).toBe(false)
    expect(body).toMatchObject({ leagueSize: 10, seatsHeld: 2, openSeats: 8 })
  })

  it("unlisting makes the league private, so discovery stops showing it", async () => {
    db.findLeagueListing.updateMany.mockResolvedValue({ count: 1 })
    db.league.findFirst.mockResolvedValue({
      settings: { league_privacy_visibility: "public", publicDashboard: true, inviteCode: "abc", description: "keep me" },
    })
    db.league.update.mockResolvedValue({})

    const res = await DELETE({} as never, ctx)
    expect(res.status).toBe(200)
    const written = db.league.update.mock.calls[0][0].data.settings
    expect(written.league_privacy_visibility).toBe("private")
    expect(written.publicDashboard).toBe(false)
    expect(written.description).toBe("keep me")
    expect(written.inviteCode).toBe("abc")
  })
})
